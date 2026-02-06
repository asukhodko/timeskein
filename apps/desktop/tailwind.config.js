/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // State colors
        'state-active': '#22c55e',
        'state-blocked': '#ef4444',
        'state-waiting': '#f59e0b',
        'state-unknown': '#6b7280',
        'state-someday': '#8b5cf6',
        'state-done': '#3b82f6',
      },
    },
  },
  plugins: [],
}
