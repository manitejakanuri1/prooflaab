import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				success: {
					DEFAULT: 'hsl(var(--success))',
					foreground: 'hsl(var(--success-foreground))'
				},
				warning: {
					DEFAULT: 'hsl(var(--warning))',
					foreground: 'hsl(var(--warning-foreground))'
				},
				// Learning-path board. Kept out of the generic scale on purpose:
				// these read as "earned / not earned", not as decoration.
				board: {
					bottom: 'hsl(var(--board-bottom))',
					top: 'hsl(var(--board-top))'
				},
				space: {
					ink: 'hsl(var(--space-ink))',
					dim: 'hsl(var(--space-ink-dim))',
					glass: 'hsl(var(--space-glass))'
				},
				trail: {
					done: 'hsl(var(--trail-done))',
					todo: 'hsl(var(--trail-todo))'
				},
				rung: {
					gold: 'hsl(var(--rung-gold))',
					'gold-deep': 'hsl(var(--rung-gold-deep))',
					pass: 'hsl(var(--rung-pass))',
					'pass-deep': 'hsl(var(--rung-pass-deep))',
					'now-deep': 'hsl(var(--rung-now-deep))',
					idle: 'hsl(var(--rung-idle))',
					'idle-deep': 'hsl(var(--rung-idle-deep))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'float-emoji': {
					'0%': {
						transform: 'translateY(0px)'
					},
					'50%': {
						transform: 'translateY(-6px)'
					},
					'100%': {
						transform: 'translateY(0px)'
					}
				},
				// The level map: nodes drop in one after another so the path reads
				// as a path rather than appearing all at once.
				'level-in': {
					from: { opacity: '0', transform: 'translateY(8px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				},
				// The one level they are on. A halo rather than a bounce — it has to
				// sit on screen indefinitely without becoming annoying.
				'level-pulse': {
					'0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0.45)' },
					'50%': { boxShadow: '0 0 0 10px hsl(var(--primary) / 0)' }
				},
				'pop-in': {
					'0%': { opacity: '0', transform: 'scale(0.94)' },
					'70%': { transform: 'scale(1.02)' },
					'100%': { opacity: '1', transform: 'scale(1)' }
				},
				'cheer': {
					'0%, 100%': { transform: 'rotate(0deg)' },
					'25%': { transform: 'rotate(-12deg)' },
					'75%': { transform: 'rotate(12deg)' }
				},
				// Game board: a node lands with a little overshoot, the way a board
				// piece drops onto its square. The centring translate is baked into
				// the keyframe because the node carries a transform of its own.
				'node-pop': {
					'0%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.3)' },
					'60%': { transform: 'translate(-50%, -50%) scale(1.12)' },
					'100%': { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' }
				},
				// The marker sitting on the level they are playing right now.
				'marker-bob': {
					'0%, 100%': { transform: 'translateX(-50%) translateY(0)' },
					'50%': { transform: 'translateX(-50%) translateY(-7px)' }
				},
				'star-twinkle': {
					'0%, 100%': { opacity: '1', transform: 'scale(1)' },
					'50%': { opacity: '0.55', transform: 'scale(0.82)' }
				},
				'confetti-fall': {
					'0%': { opacity: '1', transform: 'translateY(-12px) rotate(0deg)' },
					'100%': { opacity: '0', transform: 'translateY(260px) rotate(540deg)' }
				},
				// Recruiter dashboard: a panel easing open, not popping in.
				'slide-down': {
					from: { opacity: '0', transform: 'translateY(-4px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'float-emoji': 'float-emoji 3s ease-in-out infinite',
				'level-in': 'level-in 0.35s ease-out both',
				'level-pulse': 'level-pulse 2.4s ease-out infinite',
				'pop-in': 'pop-in 0.3s ease-out both',
				'cheer': 'cheer 0.6s ease-in-out 2',
				'node-pop': 'node-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
				'marker-bob': 'marker-bob 1.6s ease-in-out infinite',
				'star-twinkle': 'star-twinkle 2s ease-in-out infinite',
				'confetti-fall': 'confetti-fall 1.5s ease-in forwards',
				'slide-down': 'slide-down 0.25s ease-out'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
