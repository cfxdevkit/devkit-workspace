import { Toaster } from "sonner";

export function AppToaster() {
	return (
		<Toaster
			closeButton
			expand={false}
			position="top-right"
			richColors
			theme="dark"
			visibleToasts={5}
			toastOptions={{
				className:
					"!border !border-white/20 !bg-zinc-800 !text-zinc-100 !shadow-2xl",
				descriptionClassName: "!text-zinc-300",
			}}
		/>
	);
}
