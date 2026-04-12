import { jsx as _jsx } from "react/jsx-runtime";
export function Card({ children, className = '' }) {
    return (_jsx("div", { className: `bg-bg-secondary border border-border rounded-xl p-5 text-text-primary shadow-sm ${className}`, children: children }));
}
