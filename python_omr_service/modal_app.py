#!/usr/bin/env python3
"""
Modal deployment for OMR Service
Deploy: modal deploy modal_app.py
"""

import modal

# Criar a app Modal
app = modal.App("gabaritai-omr")

# Imagem com dependências e código copiado
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi",
        "python-multipart",
        "opencv-python-headless==4.8.1.78",
        "numpy==1.24.3",
        "Pillow==10.1.0",
        "flask",
        "flask-cors",
        "requests",
    )
    .add_local_file("app.py", "/app/app.py")
)


@app.function(image=image, timeout=300)
@modal.web_endpoint(method="GET", label="health")
def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "omr-service-modal",
        "version": "2.0-fixed",
        "questions": 90
    }


@app.function(image=image, timeout=300, min_containers=1)
@modal.asgi_app(label="omr-api")
def omr_api():
    """FastAPI app for OMR processing"""
    import sys
    import os

    from fastapi import FastAPI, UploadFile, File, Form
    from fastapi.responses import JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import traceback

    fastapi_app = FastAPI()

    # CORS para permitir chamadas diretas do frontend
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://xtri-gabarito.app",
            "https://xtri-gabarito-app.vercel.app",
            "https://*.vercel.app",
            "http://localhost:5173",
            "http://localhost:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Debug: list files to see if app.py is there
    @fastapi_app.get("/debug")
    def debug_info():
        app_files = os.listdir("/app") if os.path.exists("/app") else ["DIR_NOT_FOUND"]
        root_files = os.listdir("/") if os.path.exists("/") else []
        return {
            "app_dir_files": app_files,
            "root_files": root_files,
            "sys_path": sys.path[:5]
        }

    # Lazy import of processing module
    def get_process_omr(force_debug=False):
        try:
            sys.path.insert(0, "/app")
            if force_debug:
                # Need to reload the module to pick up the new env var
                import importlib
                import app as omr_app
                importlib.reload(omr_app)
                return omr_app.process_omr
            from app import process_omr
            return process_omr
        except ImportError as e:
            raise RuntimeError(f"❌ Falha ao importar app.py: {e}. Arquivos em /app: {os.listdir('/app') if os.path.exists('/app') else 'DIR_NOT_FOUND'}")
        except Exception as e:
            raise RuntimeError(f"❌ Erro ao carregar OMR: {e}")

    @fastapi_app.post("/process-image")
    async def process_image(
        image: UploadFile = File(...),
        page: int = Form(1),
        debug: bool = Form(False)
    ):
        try:
            import cv2
            import numpy as np
            from PIL import Image as PILImage
            import io
            import base64

            # Enable debug mode if requested
            if debug:
                os.environ['OMR_DEBUG'] = 'true'
                os.environ['OMR_DEBUG_DIR'] = '/tmp/omr_debug'
            else:
                os.environ['OMR_DEBUG'] = 'false'

            process_omr = get_process_omr(force_debug=debug)

            img_bytes = await image.read()
            pil_img = PILImage.open(io.BytesIO(img_bytes))

            if pil_img.mode != 'RGB':
                pil_img = pil_img.convert('RGB')

            img_array = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            result = process_omr(img_array, page)

            questoes = []
            for i, ans in enumerate(result['answers'], 1):
                if ans is None:
                    questoes.append({'numero': i, 'resposta': ''})
                elif ans == 'X':
                    questoes.append({'numero': i, 'resposta': 'X', 'invalida': True, 'motivo': 'Dupla marcacao'})
                else:
                    questoes.append({'numero': i, 'resposta': ans})

            response = {
                "status": "sucesso",
                "pagina": {
                    "pagina": page,
                    "resultado": {
                        "questoes": questoes,
                        "respondidas": result['answered'],
                        "em_branco": result['blank'],
                        "dupla_marcacao": result['double_marked']
                    },
                    "elapsed_ms": result['elapsed_ms']
                }
            }

            # Add debug image if available
            if debug and result.get('debug_image'):
                debug_path = result['debug_image']
                if os.path.exists(debug_path):
                    with open(debug_path, 'rb') as f:
                        debug_img_data = f.read()
                    response['debug_image_base64'] = base64.b64encode(debug_img_data).decode('utf-8')
                    response['debug_image_path'] = debug_path

            return response
        except Exception as e:
            return JSONResponse(
                status_code=500,
                content={"status": "erro", "mensagem": str(e), "traceback": traceback.format_exc()}
            )

    @fastapi_app.get("/health")
    def health_check():
        return {"status": "ok", "version": "2.0-fixed"}

    return fastapi_app
