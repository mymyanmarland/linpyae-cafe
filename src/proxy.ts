import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic auth check — full session verification happens in layouts/actions.
const PUBLIC_PATHS = ["/login", "/online", "/api/auth", "/api/webhooks", "/unauthorized"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/manifest.json"
  ) {
    return NextResponse.next();
  }
  const hasSession =
    request.cookies.has("cafe_session") || request.cookies.has("better-auth.session_token");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
