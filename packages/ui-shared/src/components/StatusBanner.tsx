import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";

type StatusTone = "accent" | "success" | "error" | "warning";

interface StatusBannerProps {
	message: ReactNode;
	tone?: StatusTone;
	className?: string;
	textClassName?: string;
}

function isProgressMessage(message: ReactNode) {
	if (typeof message !== "string") {
		return false;
	}

	return /(ing\.\.\.|ing…|awaiting|authorizing|preparing|syncing|quoting|swapping|approving|providing|withdrawing|depositing|funding|initializing|seeding|indexing|saving|uploading|submitting|processing|querying|mempool)/i.test(
		message,
	);
}

function getDuration(tone: StatusTone) {
	if (tone === "error") return 8000;
	if (tone === "success") return 6000;
	if (tone === "warning") return 6000;
	return 4000;
}

export function StatusBanner({
	message,
	tone = "accent",
	className = "",
	textClassName = "",
}: StatusBannerProps) {
	const toastIdRef = useRef(
		`status-${Math.random().toString(36).slice(2, 10)}`,
	);

	useEffect(() => {
		const id = toastIdRef.current;

		if (message == null || message === "") {
			toast.dismiss(id);
			return;
		}

		const options = {
			id,
			className,
			descriptionClassName: textClassName,
			duration: isProgressMessage(message) ? Infinity : getDuration(tone),
		};

		if (tone === "success") {
			toast.success(message, options);
		} else if (tone === "error") {
			toast.error(message, options);
		} else if (tone === "warning") {
			toast.warning(message, options);
		} else if (isProgressMessage(message)) {
			toast.loading(message, options);
		} else {
			toast(message, options);
		}
	}, [className, message, textClassName, tone]);

	// Dismiss on unmount so stale Infinity-duration toasts don't persist
	useEffect(() => {
		const id = toastIdRef.current;
		return () => {
			toast.dismiss(id);
		};
	}, []);

	return null;
}
