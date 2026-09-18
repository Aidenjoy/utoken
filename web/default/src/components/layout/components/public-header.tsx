/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNotifications } from '@/hooks/use-notifications'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'
import { HeaderLogo } from './header-logo'

const AUTH_PROMPT_SECONDS = 5

type AuthPromptTarget = {
  title: string
  href: string
}

export interface PublicHeaderProps {
  navLinks?: TopNavLink[]
  mobileLinks?: TopNavLink[]
  navContent?: React.ReactNode
  showThemeSwitch?: boolean
  showLanguageSwitcher?: boolean
  logo?: React.ReactNode
  siteName?: string
  homeUrl?: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  showNavigation?: boolean
  showAuthButtons?: boolean
  showNotifications?: boolean
  /** 首屏为深色整屏视觉时，导航在顶部使用白色文字。 */
  overHero?: boolean
  className?: string
}

export function PublicHeader(props: PublicHeaderProps) {
  const {
    navLinks = defaultTopNavLinks,
    showThemeSwitch = true,
    showLanguageSwitcher = true,
    logo: customLogo,
    siteName: customSiteName,
    homeUrl = 'http://model.yundashi.com',
    showAuthButtons = true,
    showNotifications = true,
    overHero = false,
  } = props

  const { t } = useTranslation()
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authPromptTarget, setAuthPromptTarget] =
    useState<AuthPromptTarget | null>(null)
  const [authPromptSecondsLeft, setAuthPromptSecondsLeft] =
    useState(AUTH_PROMPT_SECONDS)
  const { auth } = useAuthStore()
  const {
    systemName,
    logo: systemLogo,
    loading,
    logoLoaded,
  } = useSystemConfig()
  const dynamicLinks = useTopNavLinks()
  const notifications = useNotifications()
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const user = auth.user
  const isAuthenticated = !!user
  const displaySiteName = customSiteName || systemName
  const links = dynamicLinks.length > 0 ? dynamicLinks : navLinks
  const heroOverlay = overHero && !scrolled && !mobileOpen
  const navLinkIdleClass = heroOverlay
    ? 'text-white/70 hover:text-white'
    : 'text-muted-foreground hover:text-foreground'
  const navLinkActiveClass = heroOverlay ? 'text-white' : 'text-foreground'
  const navDividerClass = heroOverlay ? 'bg-white/25' : 'bg-border/40'

  let logoContent: React.ReactNode = (
    <HeaderLogo
      src={systemLogo}
      loading={loading}
      logoLoaded={logoLoaded}
      className='size-full rounded-lg object-contain'
    />
  )
  if (loading) {
    logoContent = <Skeleton className='size-full rounded-lg' />
  } else if (customLogo) {
    logoContent = customLogo
  }

  let authControl: React.ReactNode = (
    <Button
      size='sm'
      className='h-8 rounded-lg px-3.5 text-xs font-medium'
      render={<Link to='/sign-in' />}
    >
      {t('Sign in')}
    </Button>
  )
  if (loading) {
    authControl = <Skeleton className='h-8 w-20 rounded-lg' />
  } else if (isAuthenticated) {
    authControl = <ProfileDropdown />
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!authPromptTarget) return

    const intervalId = window.setInterval(() => {
      setAuthPromptSecondsLeft((seconds) => Math.max(seconds - 1, 0))
    }, 1000)

    const timeoutId = window.setTimeout(() => {
      const redirect = authPromptTarget.href
      setAuthPromptTarget(null)
      navigate({ to: '/sign-in', search: { redirect } })
    }, AUTH_PROMPT_SECONDS * 1000)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [authPromptTarget, navigate])

  const closeAuthPrompt = useCallback(() => {
    setAuthPromptTarget(null)
    setAuthPromptSecondsLeft(AUTH_PROMPT_SECONDS)
  }, [])

  const navigateToSignIn = useCallback(() => {
    const redirect = authPromptTarget?.href || '/'
    setAuthPromptTarget(null)
    navigate({ to: '/sign-in', search: { redirect } })
  }, [authPromptTarget?.href, navigate])

  const handleNavLinkClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      link: TopNavLink,
      closeMobile = false
    ) => {
      if (link.disabled) {
        event.preventDefault()
        return
      }

      if (link.requiresAuth) {
        event.preventDefault()
        if (closeMobile) {
          setMobileOpen(false)
        }
        setAuthPromptSecondsLeft(AUTH_PROMPT_SECONDS)
        setAuthPromptTarget({
          title: t(link.title),
          href: link.href,
        })
        return
      }

      if (closeMobile) {
        setMobileOpen(false)
      }
    },
    [t]
  )

  return (
    <>
      <header className='pointer-events-none fixed inset-x-0 top-0 z-50'>
        <div className='pointer-events-auto w-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]'>
          <nav
            className={cn(
              'flex items-center justify-between px-4 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] md:px-8',
              scrolled
                ? 'bg-background/75 border-border/40 h-14 border-b backdrop-blur-xl'
                : 'h-20',
              heroOverlay && 'text-white'
            )}
          >
            {/* Logo */}
            {homeUrl.startsWith('http') ? (
              <a
                href={homeUrl}
                className={cn(
                  'group flex shrink-0 items-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  scrolled ? 'gap-2' : 'gap-3.5'
                )}
              >
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105',
                    scrolled ? 'size-6' : 'size-9'
                  )}
                >
                  {logoContent}
                </div>
                <span
                  className={cn(
                    'font-bold tracking-tight transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    scrolled ? 'text-sm' : 'text-xl'
                  )}
                >
                  {loading ? (
                    <Skeleton className='h-4 w-16' />
                  ) : (
                    displaySiteName
                  )}
                </span>
              </a>
            ) : (
              <Link
                to={homeUrl}
                className={cn(
                  'group flex shrink-0 items-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  scrolled ? 'gap-2' : 'gap-3.5'
                )}
              >
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105',
                    scrolled ? 'size-6' : 'size-9'
                  )}
                >
                  {logoContent}
                </div>
                <span
                  className={cn(
                    'font-bold tracking-tight transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    scrolled ? 'text-sm' : 'text-xl'
                  )}
                >
                  {loading ? (
                    <Skeleton className='h-4 w-16' />
                  ) : (
                    displaySiteName
                  )}
                </span>
              </Link>
            )}

            {/* Desktop nav */}
            <div className='hidden items-center gap-0.5 sm:flex'>
              {links.map((link) => {
                const isActive = pathname === link.href
                if (link.children?.length) {
                  const childActive = link.children.some(
                    (child) => pathname === child.href
                  )
                  return (
                    <div key={link.title} className='group relative'>
                      <button
                        type='button'
                        className={cn(
                          'flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-200',
                          childActive ? navLinkActiveClass : navLinkIdleClass
                        )}
                      >
                        {t(link.title)}
                        <ChevronDown className='size-3.5 opacity-60 transition-transform duration-200 group-hover:rotate-180' />
                      </button>
                      <div className='invisible absolute top-full left-1/2 -translate-x-1/2 translate-y-1 pt-3 opacity-0 transition-all duration-200 ease-out group-hover:visible group-hover:translate-y-0 group-hover:opacity-100'>
                        <div className='bg-popover/90 text-popover-foreground border-border/40 min-w-60 rounded-2xl border p-2 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.5)] backdrop-blur-2xl'>
                          {link.children.map((child) => {
                            const ChildIcon = child.icon
                            if (child.disabled) {
                              return (
                                <span
                                  key={child.title}
                                  className='text-muted-foreground/60 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5'
                                >
                                  {ChildIcon && (
                                    <span className='bg-muted/70 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                                      <ChildIcon className='size-4' />
                                    </span>
                                  )}
                                  <span className='text-[13px] font-medium'>
                                    {t(child.title)}
                                  </span>
                                  <span className='bg-muted text-muted-foreground ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium'>
                                    {t('In development')}
                                  </span>
                                </span>
                              )
                            }
                            return (
                              <Link
                                key={`${child.title}-${child.href}`}
                                to={child.href}
                                onClick={(event) =>
                                  handleNavLinkClick(event, child)
                                }
                                className='group/item hover:bg-accent/80 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors'
                              >
                                {ChildIcon && (
                                  <span className='bg-muted/70 text-muted-foreground group-hover/item:bg-background group-hover/item:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors'>
                                    <ChildIcon className='size-4' />
                                  </span>
                                )}
                                <span className='text-[13px] font-medium'>
                                  {t(child.title)}
                                </span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                }
                if (link.external) {
                  return (
                    <a
                      key={`${link.title}-${link.href}`}
                      href={link.href}
                      target={link.sameTab ? undefined : '_blank'}
                      rel={link.sameTab ? undefined : 'noopener noreferrer'}
                      aria-disabled={link.disabled}
                      tabIndex={link.disabled ? -1 : undefined}
                      onClick={(event) => handleNavLinkClick(event, link)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-200',
                        navLinkIdleClass,
                        link.disabled && 'pointer-events-none opacity-50'
                      )}
                    >
                      {t(link.title)}
                    </a>
                  )
                }
                return (
                  <Link
                    key={`${link.title}-${link.href}`}
                    to={link.href}
                    disabled={link.disabled}
                    onClick={(event) => handleNavLinkClick(event, link)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-200',
                      isActive ? navLinkActiveClass : navLinkIdleClass,
                      link.disabled && 'pointer-events-none opacity-50'
                    )}
                  >
                    {t(link.title)}
                  </Link>
                )
              })}

              {(showLanguageSwitcher ||
                showThemeSwitch ||
                showNotifications) && (
                <div className={cn('mx-2 h-4 w-px', navDividerClass)} />
              )}

              {showLanguageSwitcher && <LanguageSwitcher />}
              {showThemeSwitch && <ThemeSwitch />}
              {showNotifications && (
                <NotificationPopover
                  open={notifications.popoverOpen}
                  onOpenChange={notifications.setPopoverOpen}
                  unreadCount={notifications.unreadCount}
                  activeTab={notifications.activeTab}
                  onTabChange={notifications.setActiveTab}
                  notice={notifications.notice}
                  announcements={notifications.announcements}
                  loading={notifications.loading}
                />
              )}

              {showAuthButtons && (
                <>
                  <div className={cn('mx-1 h-4 w-px', navDividerClass)} />
                  {authControl}
                </>
              )}
            </div>

            {/* Mobile: compact actions + hamburger */}
            <div className='flex items-center gap-2 sm:hidden'>
              {showThemeSwitch && <ThemeSwitch />}
              {showAuthButtons && !loading && isAuthenticated && (
                <ProfileDropdown />
              )}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-9'
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={t('Toggle navigation menu')}
              >
                <div className='relative size-4'>
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'top-[7px] rotate-45' : 'top-[3px]'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 top-[7px] block h-[1.5px] rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'scale-x-0 opacity-0' : 'opacity-100'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'top-[7px] -rotate-45' : 'top-[11px]'
                    )}
                  />
                </div>
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile full-screen overlay */}
      <div
        className={cn(
          'bg-background/98 fixed inset-0 z-40 backdrop-blur-2xl transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:pointer-events-none sm:hidden',
          mobileOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      >
        <div className='flex h-full flex-col justify-between px-8 pt-20 pb-10'>
          <nav className='flex flex-col gap-1'>
            {links.map((link, i) => {
              const isActive = pathname === link.href
              const linkClassName = cn(
                'flex items-center gap-3 py-3 text-base font-medium tracking-tight transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                mobileOpen
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-4 opacity-0',
                isActive ? 'text-foreground' : 'text-muted-foreground',
                link.disabled && 'pointer-events-none opacity-50'
              )
              const transitionStyle = {
                transitionDelay: mobileOpen ? `${100 + i * 50}ms` : '0ms',
              }
              if (link.children?.length) {
                return (
                  <div
                    key={link.title}
                    className={cn(
                      'flex flex-col transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                      mobileOpen
                        ? 'translate-y-0 opacity-100'
                        : 'translate-y-4 opacity-0'
                    )}
                    style={transitionStyle}
                  >
                    <span className='text-foreground flex items-center py-3 text-base font-medium tracking-tight'>
                      {t(link.title)}
                    </span>
                    <div className='flex flex-col pl-4'>
                      {link.children.map((child) => {
                        const ChildIcon = child.icon
                        if (child.disabled) {
                          return (
                            <span
                              key={child.title}
                              className='text-muted-foreground/50 flex items-center gap-3 py-2.5 text-[15px]'
                            >
                              {ChildIcon && (
                                <ChildIcon className='size-4 opacity-60' />
                              )}
                              {t(child.title)}
                              <span className='bg-muted rounded-full px-2 py-0.5 text-[10px] leading-none font-medium'>
                                {t('In development')}
                              </span>
                            </span>
                          )
                        }
                        return (
                          <Link
                            key={`${child.title}-${child.href}`}
                            to={child.href}
                            onClick={(event) =>
                              handleNavLinkClick(event, child, true)
                            }
                            className={cn(
                              'flex items-center gap-3 py-2.5 text-[15px]',
                              pathname === child.href
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {ChildIcon && (
                              <ChildIcon className='size-4 opacity-60' />
                            )}
                            {t(child.title)}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              }
              if (link.external) {
                return (
                  <a
                    key={`${link.title}-${link.href}`}
                    href={link.href}
                    target={link.sameTab ? undefined : '_blank'}
                    rel={link.sameTab ? undefined : 'noopener noreferrer'}
                    aria-disabled={link.disabled}
                    tabIndex={link.disabled ? -1 : undefined}
                    onClick={(event) => handleNavLinkClick(event, link, true)}
                    className={linkClassName}
                    style={transitionStyle}
                  >
                    {t(link.title)}
                  </a>
                )
              }
              return (
                <Link
                  key={`${link.title}-${link.href}`}
                  to={link.href}
                  disabled={link.disabled}
                  onClick={(event) => handleNavLinkClick(event, link, true)}
                  className={linkClassName}
                  style={transitionStyle}
                >
                  {t(link.title)}
                </Link>
              )
            })}
          </nav>

          <div
            className={cn(
              'flex flex-col gap-3 transition-all duration-500',
              mobileOpen
                ? 'translate-y-0 opacity-100'
                : 'translate-y-4 opacity-0'
            )}
            style={{ transitionDelay: mobileOpen ? '250ms' : '0ms' }}
          >
            {showAuthButtons && (
              <Link
                to={isAuthenticated ? '/dashboard' : '/sign-in'}
                onClick={() => setMobileOpen(false)}
                className='bg-foreground text-background inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80'
              >
                {isAuthenticated ? t('Go to Dashboard') : t('Sign in')}
              </Link>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!authPromptTarget}
        onOpenChange={(open) => {
          if (!open) {
            closeAuthPrompt()
          }
        }}
        title={t('Sign in required')}
        description={t('Please sign in to view {{module}}.', {
          module: authPromptTarget?.title || '',
        })}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        footer={
          <>
            <Button variant='outline' onClick={closeAuthPrompt}>
              {t('Cancel')}
            </Button>
            <Button onClick={navigateToSignIn}>{t('Sign in now')}</Button>
          </>
        }
      >
        <div className='bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-sm'>
          {t('Redirecting to sign in in {{seconds}} seconds.', {
            seconds: authPromptSecondsLeft,
          })}
        </div>
      </Dialog>
    </>
  )
}
