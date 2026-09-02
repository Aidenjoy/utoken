package director

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"unicode/utf16"
)

// cjkFallbackFonts 中文字体回退列表（按偏好排序，覆盖 macOS/Windows/Linux 常见中文字体族名）
var cjkFallbackFonts = []string{
	"SimHei", "Microsoft YaHei", "PingFang SC", "Heiti SC", "Songti SC",
	"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Source Han Sans CN",
	"WenQuanYi Micro Hei", "WenQuanYi Zen Hei", "AR PL UMing CN", "AR PL UKai CN",
	"Droid Sans Fallback", "Arial Unicode MS",
}

// textHasCJK 文本是否含 CJK 字符（决定是否需要校验渲染主机的中文字体）
func textHasCJK(s string) bool {
	for _, r := range s {
		if (r >= 0x2E80 && r <= 0xFAFF) || (r >= 0xFF00 && r <= 0xFFEF) || (r >= 0x3000 && r <= 0x303F) {
			return true
		}
	}
	return false
}

var (
	hostFontOnce   sync.Once
	hostCJKFonts   map[string]string // 小写族名 -> 显示族名（fontconfig 报告支持中文的字体）
	hostFontconfig bool              // 渲染主机 fc-list 是否可用
)

// hostCJKFamilies 查询渲染主机已安装的支持中文的字体族（缓存；fc-list 不可用时返回空集+false）
func hostCJKFamilies() (map[string]string, bool) {
	hostFontOnce.Do(func() {
		out, err := exec.Command("fc-list", ":lang=zh", "family").Output()
		if err != nil {
			return
		}
		hostFontconfig = true
		hostCJKFonts = map[string]string{}
		for _, line := range strings.Split(string(out), "\n") {
			// 一行可能含多个别名族名，逗号分隔；fontconfig 输出带反斜杠转义
			for _, name := range strings.Split(line, ",") {
				name = unescapeFc(strings.TrimSpace(name))
				if name == "" {
					continue
				}
				low := strings.ToLower(name)
				if _, ok := hostCJKFonts[low]; !ok {
					hostCJKFonts[low] = name
				}
			}
		}
	})
	return hostCJKFonts, hostFontconfig
}

// unescapeFc 去掉 fontconfig 族名中的反斜杠转义（如 Heiti\-SC → Heiti-SC）
func unescapeFc(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

var (
	bundledOnce  sync.Once
	bundledDir   string
	bundledFonts map[string]string // 小写族名 -> 显示族名
)

// isFontFile 是否为可被 libass 加载的字体文件
func isFontFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".ttf", ".otf", ".ttc":
		return true
	}
	return false
}

// scanBundledFonts 扫描内置字体目录（缓存）：运维把字体文件（如 simhei.ttf）放进
// resource/fonts/ 即可免系统安装渲染中文字幕（libass fontsdir 加载）
func scanBundledFonts() {
	bundledOnce.Do(func() {
		bundledFonts = map[string]string{}
		candidates := []string{filepath.Join("resource", "fonts")}
		if ex, err := os.Executable(); err == nil {
			candidates = append(candidates, filepath.Join(filepath.Dir(ex), "resource", "fonts"))
		}
		for _, dir := range candidates {
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			found := false
			for _, e := range entries {
				if e.IsDir() || !isFontFile(e.Name()) {
					continue
				}
				fam, perr := fontFamilyFromFile(filepath.Join(dir, e.Name()))
				if perr != nil {
					continue
				}
				found = true
				low := strings.ToLower(fam)
				if _, ok := bundledFonts[low]; !ok {
					bundledFonts[low] = fam
				}
			}
			if found {
				bundledDir = dir
				break
			}
		}
	})
}

// bundledFontsDir 内置字体目录（无字体文件时返回空串）
func bundledFontsDir() string {
	scanBundledFonts()
	return bundledDir
}

// bundledFontFamilies 内置字体的族名集合
func bundledFontFamilies() map[string]string {
	scanBundledFonts()
	return bundledFonts
}

// resolveSubtitleFont 在渲染主机上解析字幕字体：请求字体不可用时按回退列表降级，
// 避免 libass 静默落到不含中文字形的默认字体把字幕烧成方块。
// 仅 Linux 启用 fontconfig 解析（macOS libass 走 CoreText、Windows 走 DirectWrite，原生即可解析字体族名）；
// Linux 主机确认无任何中文字体时返回明确错误（宁可不渲染也不产出方块视频）。
func resolveSubtitleFont(requested string, hasCJK bool) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		requested = "PingFang SC"
	}
	if !hasCJK || runtime.GOOS != "linux" {
		return requested, nil
	}
	return resolveSubtitleFontLinux(requested)
}

// resolveSubtitleFontLinux Linux 渲染主机的字体解析链：
// 请求字体(支持中文) → 内置同名 → 回退列表(主机/内置) → 任意内置 → 无法探测时原名 → 明确报错
func resolveSubtitleFontLinux(requested string) (string, error) {
	cjk, fcOK := hostCJKFamilies()
	bundled := bundledFontFamilies()
	low := strings.ToLower(requested)
	// 1. 请求字体本机可用（支持中文）
	if d, ok := cjk[low]; ok {
		return d, nil
	}
	// 2. 内置字体同名命中（libass fontsdir 按族名加载）
	if d, ok := bundled[low]; ok {
		return d, nil
	}
	// 3. 回退列表：先主机已安装，再内置
	for _, f := range cjkFallbackFonts {
		if d, ok := cjk[strings.ToLower(f)]; ok {
			return d, nil
		}
	}
	for _, f := range cjkFallbackFonts {
		if d, ok := bundled[strings.ToLower(f)]; ok {
			return d, nil
		}
	}
	// 4. 任意内置字体兜底（运维主动放置即视为可用）
	if len(bundled) > 0 {
		names := make([]string, 0, len(bundled))
		for _, v := range bundled {
			names = append(names, v)
		}
		sort.Strings(names)
		return names[0], nil
	}
	// 5. 无法探测主机字体（无 fontconfig）：保持旧行为，仅告警
	if !fcOK {
		return requested, nil
	}
	// 6. 主机有 fontconfig 但确认无中文字体：明确报错，避免静默烧出方块
	return "", fmt.Errorf("渲染主机缺少中文字体（请求字体 %q 不可用），请安装中文字体或在服务器 resource/fonts 目录放置字体文件后重试", requested)
}

// fontFamilyFromFile 解析 ttf/otf/ttc 字体文件的 family 名（最小 name 表解析器）
func fontFamilyFromFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(data) < 12 {
		return "", errors.New("字体文件过小")
	}
	off := 0
	if string(data[0:4]) == "ttcf" { // TTC 集合：解析第一个字体面
		off = int(binary.BigEndian.Uint32(data[8:12]))
	}
	if off+12 > len(data) {
		return "", errors.New("字体头不完整")
	}
	numTables := int(binary.BigEndian.Uint16(data[off+4 : off+6]))
	nameOff, nameLen := -1, 0
	for i := 0; i < numTables; i++ {
		rec := off + 12 + i*16
		if rec+16 > len(data) {
			return "", errors.New("表目录不完整")
		}
		if string(data[rec:rec+4]) == "name" {
			nameOff = int(binary.BigEndian.Uint32(data[rec+8 : rec+12]))
			nameLen = int(binary.BigEndian.Uint32(data[rec+12 : rec+16]))
		}
	}
	if nameOff < 0 || nameLen < 6 || nameOff+6 > len(data) {
		return "", errors.New("缺少 name 表")
	}
	count := int(binary.BigEndian.Uint16(data[nameOff+2 : nameOff+4]))
	strBase := nameOff + int(binary.BigEndian.Uint16(data[nameOff+4:nameOff+6]))
	var fam, preferred string
	for i := 0; i < count; i++ {
		rec := nameOff + 6 + i*12
		if rec+12 > len(data) {
			break
		}
		platform := int(binary.BigEndian.Uint16(data[rec : rec+2]))
		nameID := int(binary.BigEndian.Uint16(data[rec+6 : rec+8]))
		ln := int(binary.BigEndian.Uint16(data[rec+8 : rec+10]))
		soff := int(binary.BigEndian.Uint16(data[rec+10 : rec+12]))
		if nameID != 1 && nameID != 16 { // 1=family, 16=preferred family
			continue
		}
		if strBase+soff+ln > len(data) {
			continue
		}
		raw := data[strBase+soff : strBase+soff+ln]
		var val string
		if platform == 0 || platform == 3 { // Unicode/Windows 平台：UTF-16BE
			val = decodeUTF16BE(raw)
		} else {
			val = string(raw)
		}
		val = strings.TrimSpace(val)
		if val == "" {
			continue
		}
		if nameID == 16 {
			if preferred == "" || platform == 3 {
				preferred = val
			}
		} else if fam == "" || platform == 3 {
			fam = val
		}
	}
	if preferred != "" {
		return preferred, nil
	}
	if fam != "" {
		return fam, nil
	}
	return "", errors.New("未找到 family 名")
}

// decodeUTF16BE UTF-16BE → UTF-8（Windows 平台 name 记录编码）
func decodeUTF16BE(b []byte) string {
	u16 := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		u16 = append(u16, binary.BigEndian.Uint16(b[i:i+2]))
	}
	return string(utf16.Decode(u16))
}
