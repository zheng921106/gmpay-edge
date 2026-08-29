import type { SupportedLocale } from "#/lib/locales";

export type SiteBrand = {
	name: string;
	logoUrl: string;
	title: string;
	supportUrl: string;
	backgroundColor: string;
	backgroundImageUrl: string;
	defaultLocale: SupportedLocale;
};

export const defaultSiteBrand: SiteBrand = {
	name: "TOGETHER9",
	logoUrl: "/favicon.png",
	title: "TOGETHER9",
	supportUrl: "",
	backgroundColor: "",
	backgroundImageUrl: "",
	defaultLocale: "en-US",
};
