import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F12',
        panel: 'rgba(16,24,32,.6)',
        neon: {
          cyan: '#00F0FF',
          magenta: '#FF3BF9',
          violet: '#8A5CFF',
        },
        acid: '#C1FF00',
      },
      boxShadow: {
        neon: '0 0 10px rgba(0,240,255,.6), 0 0 30px rgba(0,240,255,.35)',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        scanline: 'repeating-linear-gradient(0deg, rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px, rgba(0, 255, 255, 0.06) 3px)',
      }
    }
  },
  plugins: [
    function({ addUtilities }: { addUtilities: (utils: Record<string, any>) => void }){
      addUtilities({
        '.glass': {
          background: 'rgba(16,24,32,.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(0,240,255,.25)'
        },
        '.neon-border': {
          boxShadow: '0 0 10px rgba(0,240,255,.6), 0 0 30px rgba(0,240,255,.35)',
          borderColor: 'rgba(0,240,255,.65)'
        },
        '.holo': {
          background: 'linear-gradient(180deg, rgba(10,18,24,0.72), rgba(5,10,12,0.62))',
          border: '1px solid rgba(0,240,255,.25)',
          boxShadow: 'inset 0 0 24px rgba(0,240,255,.12), 0 0 30px rgba(0,240,255,.25)'
        }
      })
    }
  ]
} satisfies Config
