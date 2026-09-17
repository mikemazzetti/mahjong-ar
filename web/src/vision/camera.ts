/** Rear-camera helper for the AR view. */
export interface CameraHandle {
  video: HTMLVideoElement;
  stream: MediaStream;
  stop(): void;
}

export async function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API unavailable. Open the app over HTTPS in a modern browser.');
  }
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) resolve();
    else video.onloadedmetadata = () => resolve();
  });
  return {
    video,
    stream,
    stop() {
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}
