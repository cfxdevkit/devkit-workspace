import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function SectionHeader({ title, description, right, className = '', titleClassName = '', descriptionClassName = '', rightClassName = '', }) {
    return (_jsxs("div", { className: `relative mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`, children: [_jsxs("div", { children: [_jsx("h2", { className: `text-2xl font-black tracking-tighter text-white uppercase leading-none ${titleClassName}`, children: title }), description ? _jsx("p", { className: `mt-1 text-xs font-medium italic text-text-secondary/60 ${descriptionClassName}`, children: description }) : null] }), right ? _jsx("div", { className: rightClassName, children: right }) : null] }));
}
