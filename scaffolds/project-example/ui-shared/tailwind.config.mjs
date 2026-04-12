/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../dex-ui/index.html",
    "../../dex-ui/src/**/*.{js,ts,jsx,tsx}",
    "../../scaffolds/project-example/dapp/index.html",
    "../../scaffolds/project-example/dapp/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        bg: {
          primary: '#1A1A1A',     // Brand Black
          secondary: '#232323',   // Slightly lighter
          tertiary: '#2c2c2c'     // Even lighter for inputs/cards
        },
        border: {
          DEFAULT: '#333333',
          hover: '#444444',
          focus: '#38A1DB'        // Brand Blue
        },
        accent: {
          DEFAULT: '#38A1DB',     // Brand Blue
          hover: '#5CB9ED',
        },
        text: {
          primary: '#e1e4eb',
          secondary: '#8b8fa3',
        },
        success: '#34d399',
        warning: '#f5a623',
        error: '#f87171'
      }
    },
  },
  plugins: [],
}
