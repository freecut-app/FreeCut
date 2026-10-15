# Componentes de terceiros

O código do FreeCut é distribuído sob a licença MIT (veja `LICENSE`). O instalador também inclui os componentes abaixo, cada um com a própria licença.

| Componente | Uso no FreeCut | Licença | Código-fonte |
|---|---|---|---|
| **FFmpeg** (ffmpeg.exe, ffprobe.exe, build BtbN "win64-gpl") | análise de mídia, miniaturas, áudio, estabilização, reverso, mixagem | **GPL v3** (inclui libx264, vid.stab, rubberband) | https://ffmpeg.org · build: https://github.com/BtbN/FFmpeg-Builds |
| **whisper.cpp** b5454 (CPU e CUDA) | legendas automáticas | MIT | https://github.com/ggml-org/whisper.cpp |
| **Modelos Whisper** (small, large-v3-turbo) | reconhecimento de fala | MIT (OpenAI) | https://huggingface.co/ggerganov/whisper.cpp |
| **NVIDIA CUDA runtime** (cublas, cudart), presente no pacote CUDA do whisper.cpp | aceleração das legendas pela placa de vídeo | NVIDIA CUDA EULA (redistribuível) | https://docs.nvidia.com/cuda/eula |
| **MediaPipe Tasks Vision** + modelo Selfie Segmenter | remoção de fundo | Apache 2.0 | https://github.com/google-ai-edge/mediapipe |
| **mp4-muxer** | gravação do arquivo MP4 | MIT | https://github.com/Vanilagy/mp4-muxer |
| **Electron** / Chromium | base do aplicativo | MIT / BSD e outras (veja `LICENSES.chromium.html` na pasta do app) | https://github.com/electron/electron |

O FFmpeg roda como um programa separado, chamado pelo FreeCut por linha de comando. Ele não é ligado ao código do FreeCut. O código-fonte correspondente aos binários do FFmpeg distribuídos está nos links acima.

"CapCut" é marca registrada dos seus respectivos donos. O FreeCut é um projeto independente: não é afiliado nem endossado por eles e não usa nenhum código ou recurso deles.
