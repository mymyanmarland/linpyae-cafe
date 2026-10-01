import type { Metadata, Viewport } from "next";
import { Geist, Noto_Sans_Myanmar } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const notoMyanmar = Noto_Sans_Myanmar({
  variable: "--font-myanmar",
  subsets: ["myanmar", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Coffee Shop Manager",
  description: "Bilingual Myanmar coffee shop management system — POS, KDS, inventory, reports",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#9a3412",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="my" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=localStorage.getItem('cafe_theme');if(d==='dark'||(!d&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${notoMyanmar.variable} min-h-screen antialiased`}
      >
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
