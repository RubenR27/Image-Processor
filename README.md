# 🖼️ image-processor-k8s

> A distributed image processing pipeline on Kubernetes. An API receives images, a Redis-backed queue distributes the work, and a pool of auto-scaling workers applies transformations. The most advanced architecture in the series — Producer/Consumer, shared storage, and horizontal autoscaling all in one project.

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![K3s](https://img.shields.io/badge/cluster-k3s-blue)
![Python](https://img.shields.io/badge/python-3.11-blue)
![Celery](https://img.shields.io/badge/celery-5.x-green)
![Redis](https://img.shields.io/badge/redis-7.x-red)
![Longhorn](https://img.shields.io/badge/storage-longhorn-orange)

---

## 📸 Screenshots

> _Coming soon — screenshots of the API, worker logs, HPA scaling events, and the Longhorn volume dashboard will be added here._

---

## 📖 What is this project?

**image-processor-k8s** is a distributed image processing service. You upload an image to an API, the API pushes a job into a Redis queue, and one or more workers pick up that job and apply a watermark to the image. The result is saved to a shared volume that both the API and the workers can read and write simultaneously.

The project is intentionally over-engineered for a simple task: the goal is to build and understand a real producer/consumer architecture, shared distributed storage with `ReadWriteMany` volumes, and a `HorizontalPodAutoscaler` that spins up more workers automatically under load — the same patterns used in production ML pipelines, video transcoding services, and large-scale data processing systems.

---

## 🏗️ Architecture

```
                     ┌──────────────────────────────────────────────────┐
                     │                   k3s cluster                     │
                     │                                                    │
   POST /upload      │  ┌──────────────┐    ┌──────────────────────┐    │
  ────────────────▶  │  │   API pod    │───▶│   Redis (queue)      │    │
  (image file)       │  │  (FastAPI)   │    │   Celery broker      │    │
                     │  └──────┬───────┘    └──────────┬───────────┘    │
                     │         │                        │                │
                     │         │ writes original        │ dispatches job │
                     │         ▼                        ▼                │
                     │  ┌──────────────────────────────────────────┐    │
                     │  │         Shared PersistentVolume (RWX)    │    │
                     │  │              (Longhorn)                  │    │
                     │  └──────────────────┬───────────────────────┘    │
                     │                     │ reads + writes              │
                     │         ┌───────────▼───────────┐                │
                     │         │     Worker pods        │                │
                     │         │  (Celery + Pillow)     │ ◀── HPA        │
                     │         │  [worker-0]            │   auto-scales  │
                     │         │  [worker-1]  ...       │   on CPU load  │
                     │         └───────────────────────-┘                │
                     │                                                    │
                     │  Ingress (Traefik) → image-processor.local        │
                     └──────────────────────────────────────────────────┘
```

**Processing flow:**

1. Client uploads an image to `POST /upload`
2. API saves the original image to the shared volume and enqueues a Celery task
3. An available worker picks up the task, reads the image from the shared volume, applies a watermark, and saves the result back
4. Client polls `GET /result/{job_id}` and downloads the processed image
5. If the queue grows, the HPA detects high CPU on the worker Deployment and spawns additional worker pods automatically

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Cluster | **k3s** | Lightweight Kubernetes, low overhead for self-hosted servers |
| API | **FastAPI** (Python) | Async file uploads, minimal code |
| Task queue | **Celery 5** | Battle-tested producer/consumer for Python, integrates natively with Redis |
| Message broker | **Redis 7** | Celery uses it as the broker and result backend |
| Image processing | **Pillow** | Simple Python library for watermarking and image transforms |
| Shared storage | **Longhorn** | Cloud-native distributed storage for k3s, supports RWX volumes |
| Volume type | **PVC with ReadWriteMany** | Lets multiple pods (API + workers) mount the same volume simultaneously |
| Autoscaling | **HorizontalPodAutoscaler (HPA)** | Scales worker replicas based on CPU utilization |
| External access | **Ingress (Traefik)** | Built into k3s, routes `image-processor.local` |

---

## 📁 Project Structure

```
image-processor-k8s/
├── api/
│   ├── main.py              # FastAPI — POST /upload, GET /result/{id}
│   ├── tasks.py             # Celery task definitions (shared with worker)
│   └── Dockerfile
├── worker/
│   ├── worker.py            # Celery worker entrypoint
│   ├── tasks.py             # Same task definitions (or shared via package)
│   └── Dockerfile
├── k8s/
│   ├── api-deployment.yaml      # API Deployment + Service
│   ├── worker-deployment.yaml   # Worker Deployment
│   ├── hpa.yaml                 # HorizontalPodAutoscaler for workers
│   ├── shared-pvc.yaml          # PVC with ReadWriteMany (Longhorn)
│   ├── redis-deployment.yaml    # Redis Deployment for Celery broker
│   └── ingress.yaml             # Traefik Ingress
├── requirements.txt
└── README.md
```

---

## ⚙️ Concepts Covered

### Producer / Consumer Pattern

The API (producer) and the workers (consumers) are completely decoupled. The API does not process images — it just enqueues a job and returns immediately. Workers pick up jobs independently, at their own pace. This means the API is always fast and responsive, no matter how heavy the processing is, and you can scale producers and consumers independently.

### Celery

Celery is a distributed task queue for Python. It connects to a broker (Redis) and a result backend (also Redis). You define tasks as regular Python functions decorated with `@celery_app.task`, and workers execute them asynchronously. The API submits a task with `.delay()` or `.apply_async()` and gets back a job ID that the client can poll.

```python
@celery_app.task
def apply_watermark(image_path: str, output_path: str):
    img = Image.open(image_path)
    # ... draw watermark ...
    img.save(output_path)
```

### ReadWriteMany (RWX) Volumes

Standard Kubernetes volumes are `ReadWriteOnce` — only one pod can mount them at a time. For this project, both the API and the workers need to access the same images. A `ReadWriteMany` PVC lets any number of pods mount the volume simultaneously. Not all storage drivers support RWX — Longhorn is one of the easiest options that does on k3s.

### HorizontalPodAutoscaler (HPA)

The HPA watches a metric (CPU utilization by default) on a target Deployment and adjusts the replica count automatically. If the worker pods are under heavy load, the HPA adds more. When the queue empties and CPU drops, it scales back down. This is the core of elastic, cost-efficient infrastructure.

```yaml
spec:
  scaleTargetRef:
    name: image-worker
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

The HPA requires the **Metrics Server** to be running in the cluster (`kubectl top pods` must work before HPA can function).

### Longhorn

Longhorn is a distributed block storage system for Kubernetes. It is installed as a set of pods that manage your nodes' disks and present them as standard Kubernetes StorageClasses. Its main advantages for this project are native support for RWX volumes, a visual dashboard for volume management, and automatic replication across nodes.

---

## 🚀 Deployment Walkthrough

### Prerequisites

- k3s installed and running
- `kubectl` configured
- Helm 3 installed
- Metrics Server running (required for HPA)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/image-processor-k8s.git
cd image-processor-k8s
```

### 2. Install Longhorn (shared storage)

```bash
helm repo add longhorn https://charts.longhorn.io
helm repo update

helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --create-namespace

# Wait for all pods to be ready
kubectl -n longhorn-system get pods -w
```

Access the Longhorn dashboard:

```bash
kubectl -n longhorn-system port-forward svc/longhorn-frontend 8080:80
# Open http://localhost:8080
```

### 3. Create the shared volume

```bash
kubectl apply -f k8s/shared-pvc.yaml
kubectl get pvc shared-images
```

The PVC uses `accessModes: [ReadWriteMany]` and the `longhorn` StorageClass, so multiple pods can mount it simultaneously.

### 4. Deploy Redis (broker)

```bash
kubectl apply -f k8s/redis-deployment.yaml
kubectl get pods -l app=redis
```

### 5. Build and load images

```bash
docker build -t image-api:latest ./api
docker build -t image-worker:latest ./worker

docker save image-api:latest    | k3s ctr images import -
docker save image-worker:latest | k3s ctr images import -
```

### 6. Deploy the API and workers

```bash
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
```

Verify both deployments mount the same PVC:

```bash
kubectl get pods
kubectl describe pod <api-pod>    | grep -A5 Mounts
kubectl describe pod <worker-pod> | grep -A5 Mounts
```

### 7. Enable autoscaling

Make sure the Metrics Server is running first:

```bash
kubectl top pods   # must return data before HPA works
kubectl apply -f k8s/hpa.yaml
kubectl get hpa
```

### 8. Configure Ingress

```bash
kubectl apply -f k8s/ingress.yaml
```

Add to `/etc/hosts`:

```
<server-IP>  image-processor.local
```

### 9. Test the pipeline end to end

```bash
# Upload an image
curl -X POST http://image-processor.local/upload \
  -F "file=@photo.jpg"
# → {"job_id": "abc-123", "status": "queued"}

# Check status
curl http://image-processor.local/result/abc-123
# → {"status": "done", "result_url": "/files/abc-123_watermarked.jpg"}

# Download the processed image
curl -O http://image-processor.local/files/abc-123_watermarked.jpg
```

### 10. Trigger autoscaling

```bash
# Simulate load — upload many images in parallel
for i in $(seq 1 50); do
  curl -s -X POST http://image-processor.local/upload -F "file=@photo.jpg" &
done

# Watch the HPA react
kubectl get hpa -w
kubectl get pods -l app=image-worker -w
```

---

## 🔌 API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/upload` | Upload an image (multipart/form-data), returns `job_id` |
| `GET` | `/result/{job_id}` | Check job status and get the result URL |
| `GET` | `/files/{filename}` | Download a processed image from the shared volume |
| `GET` | `/healthz` | Health check for liveness/readiness probes |

---

## 📊 Observability

```bash
# Watch worker scale up and down
kubectl get hpa image-worker-hpa -w

# Check CPU usage
kubectl top pods -l app=image-worker

# Follow worker logs (multiple pods)
kubectl logs -l app=image-worker -f --max-log-requests 10

# Celery task inspection (inside a worker pod)
kubectl exec -it <worker-pod> -- celery -A tasks inspect active
kubectl exec -it <worker-pod> -- celery -A tasks inspect stats
```

---

## 🗺️ Roadmap

- [ ] API — `POST /upload` that enqueues a Celery task
- [ ] Worker — Celery consumer that applies a watermark with Pillow
- [ ] Redis deployed as Celery broker and result backend
- [ ] Shared PVC with `ReadWriteMany` via Longhorn
- [ ] HorizontalPodAutoscaler for the worker Deployment
- [ ] Traefik Ingress for `image-processor.local`
- [ ] livenessProbe and readinessProbe on both API and worker
- [ ] Result polling endpoint — `GET /result/{job_id}`
- [ ] Support multiple transformations (resize, grayscale, watermark)
- [ ] Longhorn dashboard deployed and accessible
- [ ] Load test script to trigger and observe HPA in action
- [ ] Metrics Server setup documented
- [ ] Custom HPA metric based on queue length (Celery + KEDA)

---

## 📚 Resources

- [Celery Documentation](https://docs.celeryq.dev/en/stable/)
- [Celery with Redis as broker](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html)
- [Pillow — Python Imaging Library](https://pillow.readthedocs.io/en/stable/)
- [Kubernetes HorizontalPodAutoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes Persistent Volumes — Access Modes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
- [Longhorn — Distributed Storage for Kubernetes](https://longhorn.io/docs/)
- [Longhorn on k3s — Quick Start](https://longhorn.io/docs/latest/deploy/install/install-with-helm/)
- [Metrics Server for Kubernetes](https://github.com/kubernetes-sigs/metrics-server)
- [KEDA — Kubernetes Event-Driven Autoscaling](https://keda.sh/) _(advanced: scale on queue length instead of CPU)_
- [FastAPI File Uploads](https://fastapi.tiangolo.com/tutorial/request-files/)

---

## 👤 Author

Personal project for learning distributed architectures, stateful storage, and autoscaling in Kubernetes.

> _"Scale the workers, not the problem."_
