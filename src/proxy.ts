import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/receipts", "/profile"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          // A refresh here rotates the token, so the cookies on the incoming
          // request are now stale. Server Components read those request
          // cookies and can't write cookies themselves, so mirror the new
          // values onto the request too — otherwise this render would try to
          // refresh again with an already-used refresh token and see no user.
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path.startsWith(p));

  if (!user && isProtected) return redirectTo("/auth");

  // Permanent accounts skip /auth; anonymous (guest) users may visit it to upgrade.
  if (user && !user.is_anonymous && path === "/auth") return redirectTo("/dashboard");

  return response;

  // A redirect is a fresh response, so any refreshed auth cookies have to be
  // copied onto it — dropping them would send the rotated token nowhere and
  // log the user out on the next request.
  function redirectTo(pathname: string) {
    const redirect = NextResponse.redirect(new URL(pathname, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth/callback).*)",
  ],
};
