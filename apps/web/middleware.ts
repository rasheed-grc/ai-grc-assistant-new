import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import {
  DEFAULT_AUTHENTICATED_PATH,
  LOGIN_PATH,
  PUBLIC_MARKETING_PATHS,
  SESSION_COOKIE,
  STALE_SESSION_PARAM,
  STALE_SESSION_VALUE,
} from "@/lib/auth/config";
import { verifySessionToken } from "@/lib/auth/session";

const intlMiddleware = createIntlMiddleware(routing);

/** Strips a leading `/ar` or `/en` segment, returning the locale-agnostic logical path. */
function stripLocalePrefix(pathname: string): { locale: string; logicalPath: string } {
  const [, maybeLocale, ...rest] = pathname.split("/");
  if (maybeLocale && (routing.locales as readonly string[]).includes(maybeLocale)) {
    return { locale: maybeLocale, logicalPath: `/${rest.join("/")}` || "/" };
  }
  return { locale: routing.defaultLocale, logicalPath: pathname };
}

/**
 * Edge auth gate + locale routing — the primary protection for every page route, composed
 * with next-intl's locale negotiation/redirect (V2-P3 design proposal §11/§15). Locale
 * resolution runs first: a request without a `/ar` or `/en` prefix is redirected to add one
 * (Arabic by default) before any auth check happens, so the auth redirect target is always
 * already locale-prefixed. Unauthenticated requests are redirected to login (preserving the
 * intended destination), except for the public marketing site. Authenticated requests to the
 * login page are bounced to the dashboard. Server-side `requireSession()` in the
 * authenticated layout backs this up as defense-in-depth.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const intlResponse = intlMiddleware(request);

  // next-intl issues a redirect when the request path has no locale prefix — let that
  // happen first; auth is checked on the follow-up request once a locale is present.
  if (intlResponse.headers.get("location")) {
    return intlResponse;
  }

  const { pathname, search } = request.nextUrl;
  const { locale, logicalPath } = stripLocalePrefix(pathname);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const isLoginRoute = logicalPath === LOGIN_PATH;
  const isPublicMarketingRoute = (PUBLIC_MARKETING_PATHS as readonly string[]).includes(
    logicalPath,
  );

  if (!session && !isLoginRoute && !isPublicMarketingRoute) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${LOGIN_PATH}`;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (session && isLoginRoute && request.nextUrl.searchParams.get(STALE_SESSION_PARAM) === STALE_SESSION_VALUE) {
    // The server already rejected this cookie (see requireSession); the edge can only check its
    // signature, so bouncing to the dashboard here would loop. Show the login page and drop it.
    intlResponse.cookies.delete(SESSION_COOKIE);
    return intlResponse;
  }

  if (session && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${DEFAULT_AUTHENTICATED_PATH}`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return intlResponse;
}

export const config = {
  // Run on page routes only — never `/api/*`. API routes are not locale-prefixed pages
  // (each handler does its own auth via `getActor()`/`requireSession()`); routing them
  // through next-intl's locale negotiation was redirecting every call to
  // `/{locale}/api/...`, a path with no matching route, breaking every client-side fetch
  // app-wide (surfaced while capturing product screenshots for the marketing page).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
