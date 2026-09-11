# Hardware acceleration

The app **detects** available encoders at boot with a real 0.1 s test encode
and re‑probes on demand (**Settings → Re‑scan encoders**). CPU (`libx264`)
always works. GPU encoders need the device passed into the `app` container and
the matching runtime.

| Encoder | Vendor | Compose override | Needs |
|---|---|---|---|
| `libx264` | CPU | — | nothing |
| `h264_vaapi` | Intel iGPU / Arc | `docker-compose.gpu-intel.yml` | `/dev/dri` + mesa/intel VA driver (in the image) |
| `h264_qsv` | Intel Quick Sync | `docker-compose.gpu-intel.yml` | `/dev/dri` + `libvpl` + non‑free `intel-media-va-driver` |
| `h264_nvenc` | NVIDIA | `docker-compose.gpu-nvidia.yml` | NVIDIA driver + NVIDIA Container Toolkit |

Compositing always runs in software; only the final encode is offloaded (the
frame is `hwupload`ed for VAAPI/QSV, passed in system memory for NVENC).

---

## NVIDIA (NVENC)

### Host prerequisites

1. NVIDIA driver installed (`nvidia-smi` works on the host).
2. **NVIDIA Container Toolkit** installed and Docker configured:
   <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html>
3. Verify:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
   ```

### Run

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu-nvidia.yml up -d
```

The override adds a `deploy.resources.reservations.devices` GPU request and the
`NVIDIA_*` env vars. Debian's FFmpeg already contains `h264_nvenc`; the toolkit
injects the driver libraries at runtime. Then **Settings → Re‑scan encoders**
should show **NVIDIA NVENC — h264_nvenc → available**; pick it on a mosaic.

### Troubleshooting

* `Cannot load libcuda.so.1` / `h264_nvenc → No NVIDIA device` — toolkit not
  active for this container; re‑check step 2 and that `--gpus`/`deploy` applied
  (`docker inspect camera-mosaic-app | grep -i nvidia`).
* `OpenEncodeSessionEx failed: out of memory` on older consumer GPUs — the NVENC
  session limit. Fewer/smaller mosaics, or a driver patch.

---

## Intel (VAAPI and Quick Sync)

### Host prerequisites

* A render node at `/dev/dri/renderD128`:
  ```bash
  ls -l /dev/dri      # expect card0 + renderD128
  ```
* With **rootful Docker** (default) no host‑group changes are needed. With
  rootless Docker, your user must be able to read the render node.

### Run

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu-intel.yml up -d
```

The override adds `devices: [/dev/dri:/dev/dri]`, `group_add: [video, render]`,
and `LIBVA_DRIVER_NAME=iHD`. The image already ships `libva2`,
`mesa-va-drivers` and `intel-media-va-driver`, which is enough for **VAAPI**.

Then **Settings → Re‑scan encoders** → **Intel VAAPI — h264_vaapi → available**.

### Quick Sync (`h264_qsv`)

QSV goes through oneVPL and, on many chips, the **non‑free** Intel media driver.
The stock image falls back to VAAPI if QSV can't initialise. To get real QSV,
extend the runtime stage:

```dockerfile
# add to the `runtime` apt-get line, with Debian non-free-firmware enabled:
#   libmfx-gen1 libvpl2 intel-media-va-driver-non-free
```

or run FFmpeg from an Intel‑oneVPL‑enabled build. VAAPI is the safe default and
is usually within a few % of QSV for H.264.

### Verify from inside the container

```bash
docker exec -it camera-mosaic-app sh -c \
  'ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD128 -f lavfi -i color=black:s=256x256:d=0.1 \
   -vf format=nv12,hwupload -c:v h264_vaapi -f null - && echo VAAPI_OK'
```

### Troubleshooting

* `No VA display found for device /dev/dri/renderD128` — the device wasn't
  passed in (missing override) or the container user isn't in `render`.
* `Failed to initialise VAAPI connection: -1 (unknown libva error)` — driver
  mismatch; try `LIBVA_DRIVER_NAME=i965` for pre‑Broadwell iGPUs.
* Works in a shell but the app says unavailable — click **Re‑scan encoders**;
  the probe result is cached.
