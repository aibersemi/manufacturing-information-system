import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { router } from "./router";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Elemen root aplikasi tidak ditemukan.");
}
if (!rootElement.hasChildNodes()) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<React.StrictMode>
			<RouterProvider router={router} />
		</React.StrictMode>,
	);
}
