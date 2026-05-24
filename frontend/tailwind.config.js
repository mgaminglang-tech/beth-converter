/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-110%)' },
          '100%': { transform: 'translateX(210%)' },
        },
      },
      animation: {
        progress: 'progress 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
