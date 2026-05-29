// Tailwind config for the extension Options page. The Play CDN can't be used
// under MV3's extension_pages CSP, so options.css is precompiled from this.
// Regenerate: npx tailwindcss@3 -c tailwind.config.cjs -i tailwind.input.css -o options.css --minify
module.exports = {
  content: ["./options.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: { 50: '#e6e8ee', 100: '#c8ccd6', 200: '#a8aebd', 400: '#8a93a6', 500: '#525968', 600: '#3a3f4a' },
        shell: { 900: '#0e0f12', 850: '#13151a', 800: '#1c1f26', 750: '#22262e', 700: '#262a33', 600: '#2c313c' },
        brand: '#f0b96a',
        'brand-dim': '#a87f3f',
        good: '#6cd28d',
        warn: '#f0b96a',
        danger: '#e57373',
      },
    },
  },
};
