import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getRepo } from "@/lib/data/repo";
import { Nav } from "@/components/nav";
import { WowheadRefresher, WowheadScripts } from "@/components/wowhead";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "projectLC — TBC Loot Council",
    template: "%s · projectLC",
  },
  description:
    "Loot council tracking for WoW TBC: character wishlists, gear progress and item distribution.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const repo = await getRepo();
  const guild = await repo.getGuild();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <WowheadScripts />
        <WowheadRefresher />
        <TooltipProvider delayDuration={200}>
          <Nav guildName={guild.name} realm={guild.realm} activePhase={guild.activePhase} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t py-4 text-center text-xs text-muted-foreground">
            projectLC · loot council tracker for TBC · wishlists via SixtyUpgrades · loot via Gargul
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
