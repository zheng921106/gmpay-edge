import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteBrandProvider } from "#/context/site-brand-provider";
import {
	defaultSiteBrand,
	type SiteBrand,
} from "#/features/settings/site-brand";
import { AppTitle } from "#/layouts/components/app-title";

describe("site brand presentation", () => {
	it("defaults public-facing branding to TOGETHER9", () => {
		expect(defaultSiteBrand.name).toBe("TOGETHER9");
		expect(defaultSiteBrand.title).toBe("TOGETHER9");
	});

	it("uses the configured name and logo in the shared app title", () => {
		const brand: SiteBrand = {
			name: "Edge Cashier",
			logoUrl: "/api/site-logo?v=7",
			title: "Edge Cashier",
			supportUrl: "",
			backgroundColor: "",
			backgroundImageUrl: "",
			defaultLocale: "en-US",
		};
		const markup = renderToStaticMarkup(
			<SiteBrandProvider brand={brand}>
				<AppTitle description />
			</SiteBrandProvider>,
		);
		expect(markup).toContain("Edge Cashier");
		expect(markup).toContain('src="/api/site-logo?v=7"');
		expect(markup).not.toContain("GMPay <");
	});
});
