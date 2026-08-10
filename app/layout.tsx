import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://yingcheng-schedule-0810.mushxxxx518.chatgpt.site"),
  title: "搞点视频拍拍",
  description: "拍摄排期与短视频文案采集工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "搞点视频拍拍",
    description: "拍摄排期 · 文案采集",
    images: [{ url: "/og.png", width: 1680, height: 945 }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
