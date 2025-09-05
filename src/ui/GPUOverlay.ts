export function showGPUOverlay() {
	if ((window as any).__gpuOverlayShown) return;
	(window as any).__gpuOverlayShown = true;
	const div = document.createElement('div');
	div.style.position = 'fixed';
	div.style.right = '8px';
	div.style.bottom = '8px';
	div.style.zIndex = '9999';
	div.style.font = '12px Orbitron, sans-serif';
	div.style.color = '#9fe';
	div.style.opacity = '0.7';
	div.textContent = 'GPU ✓';
	document.body.appendChild(div);
	setTimeout(()=>{ try { div.remove(); } catch {} }, 1500);
}
