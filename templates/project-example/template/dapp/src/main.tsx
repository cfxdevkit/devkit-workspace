import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { Providers } from "./providers";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Missing root element");
}

createRoot(rootElement).render(
	<StrictMode>
		<Providers>
			<App />
		</Providers>
	</StrictMode>,
);
