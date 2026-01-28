'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
	Play,
	Pause,
	RotateCcw,
	Info,
	Sliders,
	ChevronRight,
	ChevronLeft,
	Eraser,
	Sun,
	Moon,
	Search,
	MousePointer2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Physics Utilities ---

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

type State = {
	theta1: number;
	theta2: number;
	omega1: number;
	omega2: number;
};

type Params = {
	L1: number;
	L2: number;
	m1: number;
	m2: number;
	g: number;
};

const derivatives = (state: State, params: Params): State => {
	const { theta1, theta2, omega1, omega2 } = state;
	const { L1, L2, m1, m2, g } = params;

	const num1 = -g * (2 * m1 + m2) * Math.sin(theta1);
	const num2 = -m2 * g * Math.sin(theta1 - 2 * theta2);
	const num3 =
		-2 *
		Math.sin(theta1 - theta2) *
		m2 *
		(omega2 * omega2 * L2 + omega1 * omega1 * L1 * Math.cos(theta1 - theta2));
	const den1 = L1 * (2 * m1 + m2 - m2 * Math.cos(2 * theta1 - 2 * theta2));
	const d_omega1 = (num1 + num2 + num3) / den1;

	const num4 =
		2 *
		Math.sin(theta1 - theta2) *
		(omega1 * omega1 * L1 * (m1 + m2) +
			g * (m1 + m2) * Math.cos(theta1) +
			omega2 * omega2 * L2 * m2 * Math.cos(theta1 - theta2));
	const den2 = L2 * (2 * m1 + m2 - m2 * Math.cos(2 * theta1 - 2 * theta2));
	const d_omega2 = num4 / den2;

	return { theta1: omega1, theta2: omega2, omega1: d_omega1, omega2: d_omega2 };
};

const stepRK4 = (state: State, params: Params, h: number): State => {
	const k1 = derivatives(state, params);
	const s2 = {
		theta1: state.theta1 + (k1.theta1 * h) / 2,
		theta2: state.theta2 + (k1.theta2 * h) / 2,
		omega1: state.omega1 + (k1.omega1 * h) / 2,
		omega2: state.omega2 + (k1.omega2 * h) / 2,
	};
	const k2 = derivatives(s2, params);
	const s3 = {
		theta1: state.theta1 + (k2.theta1 * h) / 2,
		theta2: state.theta2 + (k2.theta2 * h) / 2,
		omega1: state.omega1 + (k2.omega1 * h) / 2,
		omega2: state.omega2 + (k2.omega2 * h) / 2,
	};
	const k3 = derivatives(s3, params);
	const s4 = {
		theta1: state.theta1 + k3.theta1 * h,
		theta2: state.theta2 + k3.theta2 * h,
		omega1: state.omega1 + k3.omega1 * h,
		omega2: state.omega2 + k3.omega2 * h,
	};
	const k4 = derivatives(s4, params);

	return {
		theta1: state.theta1 + (h / 6) * (k1.theta1 + 2 * k2.theta1 + 2 * k3.theta1 + k4.theta1),
		theta2: state.theta2 + (h / 6) * (k1.theta2 + 2 * k2.theta2 + 2 * k3.theta2 + k4.theta2),
		omega1: state.omega1 + (h / 6) * (k1.omega1 + 2 * k2.omega1 + 2 * k3.omega1 + k4.omega1),
		omega2: state.omega2 + (h / 6) * (k1.omega2 + 2 * k2.omega2 + 2 * k3.omega2 + k4.omega2),
	};
};

// --- Component ---

export default function DoublePendulum() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [isPlaying, setIsPlaying] = useState(true);
	const [showControls, setShowControls] = useState(true);
	const [isDarkMode, setIsDarkMode] = useState(true);

	// Simulation Params
	const [p1, setP1] = useState({ L: 130, m: 20, thetaDeg: 45 });
	const [p2, setP2] = useState({ L: 130, m: 20, thetaDeg: 22.5 });
	const [h, setH] = useState(0.05);
	const [g, setG] = useState(1.0);
	const [trailLength, setTrailLength] = useState(1000);
	const [simulationSpeed, setSimulationSpeed] = useState(1);
	const [persistentTrail, setPersistentTrail] = useState(false);
	const [strokeWidth, setStrokeWidth] = useState(2.0);

	// Viewport State (Refs for rendering and smoothness)
	const view = useRef({ zoom: 1, x: 0, y: 0, targetZoom: 1, targetX: 0, targetY: 0 });
	const [displayZoom, setDisplayZoom] = useState(1);
	const isDragging = useRef(false);
	const lastMousePos = useRef({ x: 0, y: 0 });

	// Physics State Internal
	const simState = useRef<State>({
		theta1: degToRad(p1.thetaDeg),
		theta2: degToRad(p2.thetaDeg),
		omega1: 0,
		omega2: 0,
	});
	const trail = useRef<{ x: number; y: number }[]>([]);
	const [telemetry, setTelemetry] = useState({ t1: 0, t2: 0 });

	const clearTrail = useCallback(() => {
		trail.current = [];
	}, []);

	const resetSimulation = useCallback(() => {
		simState.current = {
			theta1: degToRad(p1.thetaDeg),
			theta2: degToRad(p2.thetaDeg),
			omega1: 0,
			omega2: 0,
		};
		trail.current = [];
		view.current = { zoom: 1, x: 0, y: 0, targetZoom: 1, targetX: 0, targetY: 0 };
		setDisplayZoom(1);
	}, [p1.thetaDeg, p2.thetaDeg]);

	// Handle Input Changes to Reset physics
	useEffect(() => {
		simState.current = {
			...simState.current,
			theta1: degToRad(p1.thetaDeg),
			theta2: degToRad(p2.thetaDeg),
		};
		trail.current = [];
	}, [p1.thetaDeg, p2.thetaDeg]);

	// Mouse/Wheel Events
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();

			const delta = -e.deltaY;
			const factor = Math.pow(1.1, delta / 100);
			const newTargetZoom = Math.max(0.1, Math.min(view.current.targetZoom * factor, 100));

			const pivotX = window.innerWidth / 2;
			const pivotY = window.innerHeight / 3;
			const mouseX = e.clientX;
			const mouseY = e.clientY;

			// Zoom at cursor logic
			const dx = mouseX - pivotX;
			const dy = mouseY - pivotY;

			const newTargetX =
				dx - ((dx - view.current.targetX) / view.current.targetZoom) * newTargetZoom;
			const newTargetY =
				dy - ((dy - view.current.targetY) / view.current.targetZoom) * newTargetZoom;

			view.current.targetZoom = newTargetZoom;
			view.current.targetX = newTargetX;
			view.current.targetY = newTargetY;
		};

		const handleMouseDown = (e: MouseEvent) => {
			if (e.button === 0) {
				isDragging.current = true;
				lastMousePos.current = { x: e.clientX, y: e.clientY };
			}
		};

		const handleMouseMove = (e: MouseEvent) => {
			if (isDragging.current) {
				const dx = e.clientX - lastMousePos.current.x;
				const dy = e.clientY - lastMousePos.current.y;
				view.current.targetX += dx;
				view.current.targetY += dy;
				// Panning also updates current pos slightly faster for responsiveness
				view.current.x += dx;
				view.current.y += dy;
				lastMousePos.current = { x: e.clientX, y: e.clientY };
			}
		};

		const handleMouseUp = () => (isDragging.current = false);

		canvas.addEventListener('wheel', handleWheel, { passive: false });
		window.addEventListener('mousedown', handleMouseDown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			canvas.removeEventListener('wheel', handleWheel);
			window.removeEventListener('mousedown', handleMouseDown);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, []);

	// Main Render Loop
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d', { alpha: false });
		if (!ctx) return;

		let animationFrameId: number;

		const render = () => {
			// Update Viewport (Lerp for smoothness)
			const lerpFac = 0.15;
			view.current.zoom += (view.current.targetZoom - view.current.zoom) * lerpFac;
			view.current.x += (view.current.targetX - view.current.x) * lerpFac;
			view.current.y += (view.current.targetY - view.current.y) * lerpFac;

			// Sync display zoom for UI infrequently
			if (Math.abs(view.current.zoom - displayZoom) > 0.01) {
				setDisplayZoom(view.current.zoom);
			}

			const dpr = window.devicePixelRatio || 1;
			const w = window.innerWidth;
			const h_canvas = window.innerHeight;

			if (canvas.width !== w * dpr || canvas.height !== h_canvas * dpr) {
				canvas.width = w * dpr;
				canvas.height = h_canvas * dpr;
				canvas.style.width = `${w}px`;
				canvas.style.height = `${h_canvas}px`;
				ctx.scale(dpr, dpr);
			}

			ctx.fillStyle = isDarkMode ? '#0f172a' : '#ffffff';
			ctx.fillRect(0, 0, w, h_canvas);

			if (isPlaying) {
				const params: Params = { L1: p1.L, L2: p2.L, m1: p1.m, m2: p2.m, g };
				for (let i = 0; i < simulationSpeed; i++) {
					simState.current = stepRK4(simState.current, params, h);
					const x1 = p1.L * Math.sin(simState.current.theta1);
					const y1 = p1.L * Math.cos(simState.current.theta1);
					const x2 = x1 + p2.L * Math.sin(simState.current.theta2);
					const y2 = y1 + p2.L * Math.cos(simState.current.theta2);
					trail.current.push({ x: x2, y: y2 });
				}
				if (!persistentTrail && trail.current.length > trailLength) {
					trail.current = trail.current.slice(-trailLength);
				}
				setTelemetry({
					t1: radToDeg(simState.current.theta1),
					t2: radToDeg(simState.current.theta2),
				});
			}

			const { zoom, x: offsetX, y: offsetY } = view.current;
			ctx.save();
			ctx.translate(w / 2 + offsetX, h_canvas / 3 + offsetY);
			ctx.scale(zoom, zoom);

			// Adaptive Grid
			const baseDensity = 100;
			const exp = Math.floor(Math.log10(1 / zoom));
			const step = baseDensity * Math.pow(10, exp);
			const majorStep = step * 10;

			// Calculate visible world coordinates
			const worldLeft = (-w / 2 - offsetX) / zoom;
			const worldRight = (w / 2 - offsetX) / zoom;
			const worldTop = (-h_canvas / 3 - offsetY) / zoom;
			const worldBottom = ((2 * h_canvas) / 3 - offsetY) / zoom;

			const startX = Math.floor(worldLeft / step) * step;
			const endX = Math.ceil(worldRight / step) * step;
			const startY = Math.floor(worldTop / step) * step;
			const endY = Math.ceil(worldBottom / step) * step;

			const gridColorMinor = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
			const gridColorMajor = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

			ctx.lineWidth = 1 / zoom;

			// Draw Minor Lines
			ctx.strokeStyle = gridColorMinor;
			ctx.beginPath();
			for (let x = startX; x <= endX; x += step) {
				ctx.moveTo(x, worldTop);
				ctx.lineTo(x, worldBottom);
			}
			for (let y = startY; y <= endY; y += step) {
				ctx.moveTo(worldLeft, y);
				ctx.lineTo(worldRight, y);
			}
			ctx.stroke();

			// Draw Major Lines
			ctx.strokeStyle = gridColorMajor;
			ctx.lineWidth = 2 / zoom;
			ctx.beginPath();
			for (
				let x = Math.floor(worldLeft / majorStep) * majorStep;
				x <= worldRight;
				x += majorStep
			) {
				ctx.moveTo(x, worldTop);
				ctx.lineTo(x, worldBottom);
			}
			for (
				let y = Math.floor(worldTop / majorStep) * majorStep;
				y <= worldBottom;
				y += majorStep
			) {
				ctx.moveTo(worldLeft, y);
				ctx.lineTo(worldRight, y);
			}
			ctx.stroke();

			// Trail
			if (trail.current.length > 1) {
				ctx.strokeStyle = isDarkMode ? '#ef4444' : '#dc2626';
				ctx.lineWidth = strokeWidth / zoom;
				ctx.lineJoin = 'round';
				ctx.lineCap = 'round';
				ctx.beginPath();
				ctx.moveTo(trail.current[0].x, trail.current[0].y);
				for (let i = 1; i < trail.current.length; i++)
					ctx.lineTo(trail.current[i].x, trail.current[i].y);
				ctx.stroke();
			}

			// Pendulum
			const { theta1, theta2 } = simState.current;
			const x1 = p1.L * Math.sin(theta1);
			const y1 = p1.L * Math.cos(theta1);
			const x2 = x1 + p2.L * Math.sin(theta2);
			const y2 = y1 + p2.L * Math.cos(theta2);

			ctx.strokeStyle = isDarkMode ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
			ctx.lineWidth = 2 / zoom;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();

			ctx.fillStyle = '#10b981';
			ctx.beginPath();
			ctx.arc(x1, y1, (8 + p1.m / 10) / zoom, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#ef4444';
			ctx.beginPath();
			ctx.arc(x2, y2, (8 + p2.m / 10) / zoom, 0, Math.PI * 2);
			ctx.fill();

			// Pivot
			ctx.fillStyle = isDarkMode ? '#fff' : '#000';
			ctx.beginPath();
			ctx.arc(0, 0, 4 / zoom, 0, Math.PI * 2);
			ctx.fill();

			ctx.restore();
			animationFrameId = requestAnimationFrame(render);
		};

		render();
		return () => cancelAnimationFrame(animationFrameId);
	}, [
		isPlaying,
		p1,
		p2,
		h,
		g,
		trailLength,
		simulationSpeed,
		persistentTrail,
		isDarkMode,
		strokeWidth,
		displayZoom,
	]);

	return (
		<div
			className={`relative w-full h-screen overflow-hidden ${isDarkMode ? 'bg-[#0f172a] text-slate-200' : 'bg-[#ffffff] text-slate-800'} font-sans`}>
			<canvas ref={canvasRef} className="absolute inset-0 z-0" />

			{/* Simplified Top UI */}
			<div className="absolute top-6 left-6 flex gap-3 z-10">
				<div
					className={`p-4 rounded-xl border flex flex-col gap-1 ${isDarkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'} shadow-xl`}>
					<h1 className="text-sm font-bold uppercase tracking-wider">
						Pendulum Precision
					</h1>
					<p className="text-[10px] text-slate-500 font-mono">
						Zoom: {Math.round(displayZoom * 100)}% | Speed: {simulationSpeed}x
					</p>
				</div>
				<button
					onClick={() => setIsDarkMode(!isDarkMode)}
					className={`p-3 rounded-xl border shadow-xl ${isDarkMode ? 'bg-slate-900 border-white/10 text-amber-500' : 'bg-white border-slate-200 text-slate-700'}`}>
					{isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
				</button>
				<button
					onClick={() => {
						view.current.targetZoom = 1;
						view.current.targetX = 0;
						view.current.targetY = 0;
					}}
					className={`p-3 rounded-xl border shadow-xl ${isDarkMode ? 'bg-slate-900 border-white/10 text-slate-300' : 'bg-white border-slate-200 text-slate-700'}`}>
					<MousePointer2 size={20} />
				</button>
			</div>

			{/* Control Sidebar */}
			<AnimatePresence>
				{showControls && (
					<motion.div
						initial={{ x: 350 }}
						animate={{ x: 0 }}
						exit={{ x: 350 }}
						className="absolute right-0 top-0 h-full w-72 z-20 pointer-events-none">
						<div
							className={`h-full border-l p-6 pointer-events-auto flex flex-col gap-6 overflow-y-auto ${isDarkMode ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200'} shadow-2xl`}>
							<div className="flex items-center justify-between border-b border-gray-500/20 pb-4">
								<span className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
									<Sliders size={14} /> Params
								</span>
								<button
									onClick={() => setShowControls(false)}
									className="p-1 hover:bg-gray-500/10 rounded">
									<ChevronRight size={18} />
								</button>
							</div>

							<ControlGroup label="Pendulum 1">
								<Input
									label="θ₁ (deg)"
									value={p1.thetaDeg}
									onChange={(v: number) => setP1((p) => ({ ...p, thetaDeg: v }))}
									min={-360}
									max={360}
									step={1}
									isDarkMode={isDarkMode}
								/>
								<Input
									label="L₁ (px)"
									value={p1.L}
									onChange={(v: number) => setP1((p) => ({ ...p, L: v }))}
									min={10}
									max={500}
									step={1}
									isDarkMode={isDarkMode}
								/>
								<Input
									label="m₁ (kg)"
									value={p1.m}
									onChange={(v: number) => setP1((p) => ({ ...p, m: v }))}
									min={1}
									max={100}
									step={1}
									isDarkMode={isDarkMode}
								/>
							</ControlGroup>

							<ControlGroup label="Pendulum 2">
								<Input
									label="θ₂ (deg)"
									value={p2.thetaDeg}
									onChange={(v: number) => setP2((p) => ({ ...p, thetaDeg: v }))}
									min={-360}
									max={360}
									step={1}
									isDarkMode={isDarkMode}
								/>
								<Input
									label="L₂ (px)"
									value={p2.L}
									onChange={(v: number) => setP2((p) => ({ ...p, L: v }))}
									min={10}
									max={500}
									step={1}
									isDarkMode={isDarkMode}
								/>
								<Input
									label="m₂ (kg)"
									value={p2.m}
									onChange={(v: number) => setP2((p) => ({ ...p, m: v }))}
									min={1}
									max={100}
									step={1}
									isDarkMode={isDarkMode}
								/>
							</ControlGroup>

							<ControlGroup label="Rendering">
								<Input
									label="Stroke Width"
									value={strokeWidth}
									onChange={setStrokeWidth}
									min={0.1}
									max={10}
									step={0.1}
									isDarkMode={isDarkMode}
								/>
								<div className="flex items-center justify-between text-[10px] font-bold uppercase py-1">
									<span className="text-slate-500">Persistent Trail</span>
									<button
										onClick={() => setPersistentTrail(!persistentTrail)}
										className={`w-8 h-4 rounded-full relative ${persistentTrail ? 'bg-emerald-500' : 'bg-slate-700'}`}>
										<div
											className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-all ${persistentTrail ? 'ml-4' : ''}`}
										/>
									</button>
								</div>
							</ControlGroup>

							<ControlGroup label="Simulation">
								<Input
									label="Time Step (h)"
									value={h}
									onChange={setH}
									min={0.001}
									max={0.2}
									step={0.001}
									isDarkMode={isDarkMode}
								/>
								<Input
									label="Gravity (g)"
									value={g}
									onChange={setG}
									min={0}
									max={10}
									step={0.1}
									isDarkMode={isDarkMode}
								/>
								<div className="grid grid-cols-4 gap-1 pt-2">
									{[1, 2, 5, 10].map((s) => (
										<button
											key={s}
											onClick={() => setSimulationSpeed(s)}
											className={`py-1.5 text-[8px] font-bold rounded ${simulationSpeed === s ? 'bg-emerald-500 text-white' : 'bg-gray-500/10'}`}>
											{s}x
										</button>
									))}
								</div>
							</ControlGroup>

							<div className="mt-auto flex flex-col gap-2 pt-6">
								<button
									onClick={() => setIsPlaying(!isPlaying)}
									className={`w-full py-3 rounded-xl font-bold text-xs shadow-lg transition-all ${isPlaying ? 'bg-amber-500/20 text-amber-600 border border-amber-500/30' : 'bg-emerald-500 text-white'}`}>
									{isPlaying ? 'PAUSE' : 'START'}
								</button>
								<div className="flex gap-2">
									<button
										onClick={clearTrail}
										className="flex-1 py-2 bg-gray-500/10 hover:bg-gray-500/20 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all">
										<Eraser size={12} /> CLEAR
									</button>
									<button
										onClick={resetSimulation}
										className="flex-1 py-2 bg-gray-500/10 hover:bg-gray-500/20 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all">
										<RotateCcw size={12} /> RESET
									</button>
								</div>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{!showControls && (
				<button
					onClick={() => setShowControls(true)}
					className={`absolute right-0 top-1/2 -translate-y-1/2 p-3 rounded-l-xl border z-20 ${isDarkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'}`}>
					<ChevronLeft size={20} />
				</button>
			)}

			{/* Simplified Telemetry */}
			<div className="absolute bottom-6 left-6 z-10 w-48">
				<div
					className={`p-4 rounded-xl border ${isDarkMode ? 'bg-slate-900/80 border-white/10' : 'bg-white/80 border-slate-200'} shadow-xl`}>
					<div className="flex flex-col gap-3">
						<TelemetryItem label="θ₁" value={telemetry.t1} color="emerald" />
						<TelemetryItem label="θ₂" value={telemetry.t2} color="rose" />
					</div>
				</div>
			</div>
		</div>
	);
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-3">
			<h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-gray-500/10 pb-1">
				{label}
			</h3>
			{children}
		</div>
	);
}

function Input({
	label,
	value,
	onChange,
	min,
	max,
	step,
	isDarkMode,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	min: number;
	max: number;
	step: number;
	isDarkMode: boolean;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex justify-between text-[10px] font-bold">
				<span className="text-slate-400">{label}</span>
				<span className={isDarkMode ? 'text-white' : 'text-slate-900'}>
					{value.toFixed(2)}
				</span>
			</div>
			<input
				type="range"
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				min={min}
				max={max}
				step={step}
				className="w-full h-1 bg-gray-500/20 rounded-lg appearance-none cursor-pointer accent-emerald-500"
			/>
		</div>
	);
}

function TelemetryItem({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color: 'emerald' | 'rose';
}) {
	const bg = color === 'emerald' ? 'bg-emerald-500' : 'bg-rose-500';
	const text = color === 'emerald' ? 'text-emerald-500' : 'text-rose-500';
	return (
		<div className="space-y-1">
			<div className="flex justify-between text-[10px] font-bold">
				<span className="text-slate-500">{label}</span>
				<span className={`font-mono ${text}`}>{value.toFixed(2)}°</span>
			</div>
			<div className="w-full h-1 bg-gray-500/10 rounded-full overflow-hidden">
				<motion.div
					initial={false}
					animate={{ width: `${(Math.abs(value % 360) / 360) * 100}%` }}
					className={`h-full ${bg}`}
				/>
			</div>
		</div>
	);
}
