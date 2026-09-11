// Lazy, browser-local inference. Only model/library downloads use the network.
let whisper;
let taskId = 0;
const progress = event => {
  if (event.status === 'progress') postMessage({ id: taskId, progress: `Downloading local voice model: ${Math.round(event.progress || 0)}%` });
};
async function ears() {
  if (!whisper) whisper = (async () => {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    if (navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null)) {
      try {
        return await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
          device: 'webgpu', dtype: 'fp32', progress_callback: progress
        });
      } catch { postMessage({ id: taskId, progress: 'Using local CPU speech recognition…' }); }
    }
    return pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      device: 'wasm', dtype: 'q8', progress_callback: progress
    });
  })().catch(error => { whisper = null; throw error; });
  return whisper;
}
onmessage = async ({ data }) => {
  taskId = data.id;
  try {
    if (data.type === 'transcribe') {
      const transcriber = await ears();
      const result = await transcriber(data.audio, { max_new_tokens: 128, chunk_length_s: 30, stride_length_s: 5 });
      postMessage({ id: data.id, text: String(result.text || '').trim() });

    }
  } catch (error) { postMessage({ id: data.id, error: `Local voice model unavailable: ${error.message}` }); }
};
