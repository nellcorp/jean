IMAGE ?= jean:dev
PLATFORM ?= linux/amd64
DOCKER_BUILD_FLAGS ?=

.PHONY: docker-build docker-build-nocache docker-run docker-shell docker-clean

docker-build:
	docker build --platform $(PLATFORM) $(DOCKER_BUILD_FLAGS) -t $(IMAGE) .

docker-build-nocache:
	$(MAKE) docker-build DOCKER_BUILD_FLAGS=--no-cache

docker-run:
	docker run --rm -it -p 3456:3456 -p 3457:3457 $(IMAGE)

docker-shell:
	docker run --rm -it --entrypoint bash $(IMAGE)

docker-clean:
	docker rmi $(IMAGE) 2>/dev/null || true
