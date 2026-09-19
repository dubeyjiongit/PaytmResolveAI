/**
 * PaytmResolve AI — Real QR Code Scanner
 * ---------------------------------------------------------------------------
 * This is a genuine QR decoder, not a mock: it opens the device camera via
 * `getUserMedia`, grabs frames onto a canvas, and runs them through jsQR
 * (a real QR-decoding library) every ~200ms until a code is found. Point it
 * at any real QR code — a UPI payment QR, a URL, plain text — and it will
 * actually decode it.
 *
 * Once decoded, this component only *reads* the code; it's up to the caller
 * to decide what to do with the text (e.g. a UPI QR payload like
 * "upi://pay?pa=name@bank&am=500" gets parsed into a receiver + amount and
 * handed to the Send Money form — see PaymentApp's onScanResult handling).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { AlertTriangle, Camera, X } from 'lucide-react';

export interface QrScannerProps {
  onResult: (text: string) => void;
  onCancel: () => void;
}

export default function QrScanner({ onResult, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser or context does not support camera access (getUserMedia unavailable).');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch (err) {
        // Real, honest failure modes: permission denied, no camera present,
        // insecure context (camera access requires https or localhost), etc.
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access and try again.'
            : err instanceof DOMException && err.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not access the camera. Make sure this page is loaded over HTTPS (or localhost) and camera permission is allowed.';
        setError(message);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // The actual decode step — jsQR runs a real QR-finder + Reed-Solomon
      // decode against the pixel data, not a lookup table or a fake.
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code && code.data) {
        setScanning(false);
        onResult(code.data);
        return; // stop the loop — a result was found
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/90 p-4">
      <div className="flex w-full max-w-sm items-center justify-between px-1 pb-3 text-white">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Camera className="h-4 w-4" /> Scan QR Code
        </div>
        <button type="button" onClick={onCancel} className="rounded-full p-1.5 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {scanning && !error && (
          <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center text-white">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>

      <p className="mt-4 max-w-sm text-center text-xs text-white/60">
        Point your camera at a real QR code — a UPI payment QR, a URL, or any text QR. This uses your device camera
        and decodes it live.
      </p>
    </div>
  );
}
