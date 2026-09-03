package volcengine

var ModelList = []string{
	"Doubao-pro-128k",
	"Doubao-pro-32k",
	"Doubao-pro-4k",
	"Doubao-lite-128k",
	"Doubao-lite-32k",
	"Doubao-lite-4k",
	"Doubao-embedding",
	"doubao-seedream-4-0-250828",
	"seedream-4-0-250828",
	"doubao-seedance-1-0-pro-250528",
	"seedance-1-0-pro-250528",
	"doubao-seed-1-6-thinking-250715",
	"seed-1-6-thinking-250715",
}

// ImageModelList is the default model set suggested for the image-generation
// channel type (火山方舟（图片）), which only serves /v1/images/generations.
var ImageModelList = []string{
	"doubao-seedream-4-0-250828",
	"seedream-4-0-250828",
}

var ChannelName = "volcengine"
