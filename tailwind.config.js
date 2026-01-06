/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/renderer/**/*.{js,jsx,ts,tsx,html}",
    ],
    theme: {
        extend: {
            colors: {
                background: '#000000', // Pure Black
                surface: '#0a0a0a', // Very dark gray
                primary: '#e0e0e0', // Silver
                secondary: '#a0a0a0', // Darker Silver
                accent: '#ffffff', // Bright Shine
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            backgroundImage: {
                'main-gradient': 'linear-gradient(to bottom, #000000, #0a0a0a)',
                'silver-gradient': 'linear-gradient(135deg, #e0e0e0 0%, #ffffff 50%, #e0e0e0 100%)',
                'silver-hover': 'linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%)',
                'shiny-black': 'linear-gradient(145deg, #1a1a1a, #000000)',
                'glass-dark': 'linear-gradient(180deg, rgba(10, 10, 10, 0.9) 0%, rgba(0, 0, 0, 0.95) 100%)',
            }
        },
    },
    plugins: [],
}
