import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const merchantContextSelectionInput = z.object({
	merchantId: z.uuid(),
	environmentId: z.uuid(),
	environment: z.enum(["sandbox", "production"]),
});

export const selectMerchantContextFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof merchantContextSelectionInput>) =>
		merchantContextSelectionInput.parse(input),
	)
	.handler(async ({ data }) => {
		const request = getRequest();
		const { selectMerchantContext, setMerchantContext } = await import(
			"#/server/merchant-context"
		);
		const context = await selectMerchantContext(request, data);
		setResponseHeader("set-cookie", await setMerchantContext(request, context));
		return context;
	});

export const selectDefaultMerchantContextFn = createServerFn({
	method: "POST",
}).handler(async () => {
	const request = getRequest();
	const { selectDefaultMerchantContext, setMerchantContext } = await import(
		"#/server/merchant-context"
	);
	const context = await selectDefaultMerchantContext(request);
	if (context)
		setResponseHeader("set-cookie", await setMerchantContext(request, context));
	return context;
});

export const listMerchantContextsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { listRequestMerchantContexts } = await import(
			"#/server/merchant-context"
		);
		return listRequestMerchantContexts(getRequest());
	},
);
