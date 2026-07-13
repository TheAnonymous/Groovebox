(function () {
  "use strict";

  const VERSION = "0.3.1";
  const initialized = new WeakMap();
  const openLayers = [];
  let globalListenersReady = false;

  const selector = {
    focusable: [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","),
    modalLayer: ".bu-overlay, .bu-drawer-overlay",
    floatingLayer: ".bu-popover, .bu-menu",
  };

  function elements(root, query) {
    const result = root.querySelectorAll ? [...root.querySelectorAll(query)] : [];
    if (root instanceof Element && root.matches(query)) result.unshift(root);
    return result;
  }

  function setup(element, key, callback) {
    const keys = initialized.get(element) || new Set();
    if (keys.has(key)) return;
    keys.add(key);
    initialized.set(element, keys);
    callback();
  }

  function resolveTarget(target) {
    if (target instanceof Element) return normalizeLayer(target);
    if (typeof target !== "string" || !target.trim()) return null;
    try {
      return normalizeLayer(document.querySelector(target));
    } catch (_) {
      return null;
    }
  }

  function normalizeLayer(element) {
    if (!element) return null;
    if (element.matches(".bu-dialog, .bu-drawer")) {
      return element.closest(selector.modalLayer) || element;
    }
    return element;
  }

  function emit(element, name) {
    element.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { target: element } }));
  }

  function isModal(element) {
    return element.matches(selector.modalLayer);
  }

  function visibleFocusable(container) {
    return [...container.querySelectorAll(selector.focusable)].filter((item) => {
      return !item.hidden && item.getAttribute("aria-hidden") !== "true" && item.getClientRects().length > 0;
    });
  }

  function positionFloating(layer, trigger, kind) {
    if (!trigger || !trigger.isConnected || layer.hidden) return;
    const gap = kind === "tooltip" ? 8 : 6;
    const triggerRect = trigger.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const margin = 8;
    let left = kind === "tooltip"
      ? triggerRect.left + (triggerRect.width - layerRect.width) / 2
      : triggerRect.left;
    let top = triggerRect.bottom + gap;

    if (top + layerRect.height > window.innerHeight - margin) {
      top = triggerRect.top - layerRect.height - gap;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - layerRect.width - margin));
    top = Math.max(margin, top);
    layer.style.left = `${Math.round(left)}px`;
    layer.style.top = `${Math.round(top)}px`;
  }

  function rememberLayer(layer, trigger) {
    const existing = openLayers.indexOf(layer);
    if (existing >= 0) openLayers.splice(existing, 1);
    layer.__buTrigger = trigger || layer.__buTrigger || document.activeElement;
    openLayers.push(layer);
  }

  function open(target, trigger) {
    const layer = resolveTarget(target);
    if (!layer) return null;
    const opener = trigger instanceof Element ? trigger : document.activeElement;
    if (!layer.hidden && layer.dataset.state === "open") return layer;

    layer.__buRestoreFocus = opener instanceof HTMLElement ? opener : null;
    layer.hidden = false;
    layer.dataset.state = "open";
    layer.setAttribute("aria-hidden", "false");
    rememberLayer(layer, opener);

    if (opener && opener.hasAttribute("aria-expanded")) opener.setAttribute("aria-expanded", "true");

    if (isModal(layer)) {
      document.body.classList.add("bu-scroll-locked");
      requestAnimationFrame(() => {
        const preferred = layer.querySelector("[autofocus]");
        const focusable = visibleFocusable(layer);
        (preferred || focusable[0] || layer).focus({ preventScroll: true });
      });
    } else {
      requestAnimationFrame(() => positionFloating(layer, opener, layer.matches(".bu-tooltip") ? "tooltip" : "floating"));
    }

    emit(layer, "bu:open");
    return layer;
  }

  function close(target, options) {
    const layer = resolveTarget(target);
    if (!layer || layer.hidden) return layer;
    const settings = Object.assign({ restoreFocus: true }, options);
    const index = openLayers.lastIndexOf(layer);
    if (index >= 0) openLayers.splice(index, 1);

    layer.hidden = true;
    layer.dataset.state = "closed";
    layer.setAttribute("aria-hidden", "true");
    layer.style.removeProperty("left");
    layer.style.removeProperty("top");
    if (layer.__buTrigger && layer.__buTrigger.hasAttribute("aria-expanded")) {
      layer.__buTrigger.setAttribute("aria-expanded", "false");
    }
    if (!openLayers.some((item) => isModal(item) && !item.hidden)) {
      document.body.classList.remove("bu-scroll-locked");
    }
    if (settings.restoreFocus && layer.__buRestoreFocus && layer.__buRestoreFocus.isConnected) {
      requestAnimationFrame(() => layer.__buRestoreFocus.focus({ preventScroll: true }));
    }
    emit(layer, "bu:close");
    return layer;
  }

  function topLayer() {
    return [...openLayers].reverse().find((item) => item.isConnected && !item.hidden);
  }

  function trapFocus(event, layer) {
    if (!isModal(layer)) return;
    const focusable = visibleFocusable(layer);
    if (!focusable.length) {
      event.preventDefault();
      layer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeOtherFloating(except, eventTarget) {
    [...openLayers].reverse().forEach((layer) => {
      if (layer === except || isModal(layer) || layer.hidden) return;
      if (layer.contains(eventTarget) || (layer.__buTrigger && layer.__buTrigger.contains(eventTarget))) return;
      close(layer, { restoreFocus: false });
    });
  }

  function initGlobalListeners() {
    if (globalListenersReady) return;
    globalListenersReady = true;

    document.addEventListener("keydown", (event) => {
      const layer = topLayer();
      if (!layer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close(layer);
      } else if (event.key === "Tab") {
        const topModal = [...openLayers].reverse().find((item) => isModal(item) && !item.hidden);
        if (topModal) trapFocus(event, topModal);
      }
    });

    document.addEventListener("pointerdown", (event) => closeOtherFloating(null, event.target));
    window.addEventListener("resize", () => {
      openLayers.forEach((layer) => {
        if (!isModal(layer)) positionFloating(layer, layer.__buTrigger, "floating");
      });
    });
    window.addEventListener("scroll", () => {
      openLayers.forEach((layer) => {
        if (!isModal(layer)) positionFloating(layer, layer.__buTrigger, "floating");
      });
    }, true);
  }

  function initOpenClose(root) {
    elements(root, "[data-bu-open]").forEach((trigger) => setup(trigger, "open", () => {
      trigger.addEventListener("click", () => open(trigger.dataset.buOpen, trigger));
    }));

    elements(root, "[data-bu-close]").forEach((trigger) => setup(trigger, "close", () => {
      trigger.addEventListener("click", () => {
        const explicit = trigger.dataset.buClose;
        close(explicit || trigger.closest(`${selector.modalLayer}, ${selector.floatingLayer}`));
      });
    }));

    elements(root, selector.modalLayer).forEach((layer) => setup(layer, "backdrop", () => {
      layer.addEventListener("pointerdown", (event) => {
        if (event.target === layer) close(layer);
      });
    }));
  }

  function activateTab(tab, tabs, focus) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
  }

  function initTabs(root) {
    elements(root, "[data-bu-tabs]").forEach((tabsRoot) => setup(tabsRoot, "tabs", () => {
      const tabs = [...tabsRoot.querySelectorAll("[role='tab']")];
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => activateTab(tab, tabs, false));
        tab.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.indexOf(tab);
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
          if (event.key === "Home") next = 0;
          if (event.key === "End") next = tabs.length - 1;
          activateTab(tabs[next], tabs, true);
        });
      });
    }));
  }

  function initSegmented(root) {
    elements(root, "[data-bu-segmented]").forEach((group) => setup(group, "segmented", () => {
      const buttons = [...group.querySelectorAll("button:not([disabled])")];
      const select = (button, focus) => {
        buttons.forEach((item) => {
          const selected = item === button;
          item.setAttribute("aria-pressed", String(selected));
          item.tabIndex = selected ? 0 : -1;
        });
        if (focus) button.focus();
        group.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: button.value || button.textContent.trim() } }));
      };
      buttons.forEach((button) => {
        button.addEventListener("click", () => select(button, false));
        button.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = buttons.indexOf(button);
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
          if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
          if (event.key === "Home") next = 0;
          if (event.key === "End") next = buttons.length - 1;
          select(buttons[next], true);
        });
      });
    }));
  }

  function initSwitches(root) {
    elements(root, ".bu-switch[role='switch']").forEach((control) => setup(control, "switch", () => {
      control.addEventListener("click", () => {
        if (control.disabled) return;
        const checked = control.getAttribute("aria-checked") === "true";
        control.setAttribute("aria-checked", String(!checked));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }));
  }

  function initAccordion(root) {
    elements(root, "[data-bu-accordion]").forEach((accordion) => setup(accordion, "accordion", () => {
      const triggers = [...accordion.querySelectorAll("[data-bu-accordion-trigger]")];
      triggers.forEach((trigger) => trigger.addEventListener("click", () => {
        const expanded = trigger.getAttribute("aria-expanded") === "true";
        const panel = document.getElementById(trigger.getAttribute("aria-controls"));
        trigger.setAttribute("aria-expanded", String(!expanded));
        if (panel) panel.hidden = expanded;
      }));
    }));
  }

  function initRanges(root) {
    elements(root, "[data-bu-range]").forEach((range) => setup(range, "range", () => {
      const input = range.querySelector("input[type='range']");
      const output = range.querySelector("output");
      if (!input || !output) return;
      const update = () => {
        const suffix = range.dataset.buSuffix || "";
        output.value = `${input.value}${suffix}`;
        output.textContent = output.value;
      };
      input.addEventListener("input", update);
      update();
    }));
  }

  function initNumbers(root) {
    elements(root, "[data-bu-number]").forEach((stepper) => setup(stepper, "number", () => {
      const input = stepper.querySelector("input[type='number']");
      if (!input) return;
      stepper.querySelectorAll("[data-bu-number-action]").forEach((button) => {
        button.addEventListener("click", () => {
          if (input.disabled || input.readOnly) return;
          button.dataset.buNumberAction === "increment" ? input.stepUp() : input.stepDown();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    }));
  }

  function initPasswords(root) {
    elements(root, "[data-bu-password-toggle]").forEach((button) => setup(button, "password", () => {
      button.addEventListener("click", () => {
        const wrapper = button.closest(".bu-password");
        const input = wrapper && wrapper.querySelector("input");
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-pressed", String(show));
        button.setAttribute("aria-label", show ? "Passwort ausblenden" : "Passwort anzeigen");
        const use = button.querySelector("use");
        if (use) use.setAttribute("href", `icons.svg#${show ? "eye-off" : "eye"}`);
      });
    }));
  }

  function initSearch(root) {
    elements(root, "[data-bu-search-clear]").forEach((button) => setup(button, "search", () => {
      const wrapper = button.closest(".bu-search");
      const input = wrapper && wrapper.querySelector("input");
      if (!input) return;
      const sync = () => { button.hidden = !input.value; };
      button.addEventListener("click", () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        sync();
      });
      input.addEventListener("input", sync);
      sync();
    }));
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function initFiles(root) {
    elements(root, "[data-bu-file]").forEach((fileRoot) => setup(fileRoot, "file", () => {
      const input = fileRoot.querySelector("input[type='file']");
      const dropzone = fileRoot.querySelector(".bu-file__dropzone");
      const list = fileRoot.querySelector(".bu-file__list");
      if (!input || !dropzone || !list) return;

      const render = (files) => {
        list.replaceChildren();
        [...files].forEach((file) => {
          const item = document.createElement("li");
          item.className = "bu-file__item";
          const name = document.createElement("span");
          name.textContent = file.name;
          const size = document.createElement("span");
          size.className = "bu-muted bu-mono";
          size.textContent = formatBytes(file.size);
          item.append(name, size);
          list.append(item);
        });
        fileRoot.dataset.state = files.length ? "selected" : "empty";
      };

      input.addEventListener("change", () => render(input.files));
      ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.dataset.state = "dragover";
      }));
      ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.dataset.state = "idle";
      }));
      dropzone.addEventListener("drop", (event) => {
        const files = event.dataTransfer.files;
        try { input.files = files; } catch (_) { /* Some browsers keep FileList read-only. */ }
        render(files);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }));
  }

  function initPopovers(root) {
    elements(root, "[data-bu-popover]").forEach((trigger) => setup(trigger, "popover", () => {
      const target = trigger.dataset.buPopover;
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const layer = resolveTarget(target);
        if (!layer) return;
        if (layer.hidden) {
          closeOtherFloating(layer, trigger);
          open(layer, trigger);
        } else close(layer);
      });
    }));
  }

  function initTooltips(root) {
    elements(root, "[data-bu-tooltip]").forEach((trigger) => setup(trigger, "tooltip", () => {
      const tooltip = document.querySelector(trigger.dataset.buTooltip);
      if (!tooltip) return;
      const show = () => {
        tooltip.hidden = false;
        tooltip.setAttribute("aria-hidden", "false");
        tooltip.__buTrigger = trigger;
        positionFloating(tooltip, trigger, "tooltip");
      };
      const hide = () => {
        tooltip.hidden = true;
        tooltip.setAttribute("aria-hidden", "true");
      };
      trigger.addEventListener("mouseenter", show);
      trigger.addEventListener("mouseleave", hide);
      trigger.addEventListener("focus", show);
      trigger.addEventListener("blur", hide);
      trigger.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
    }));
  }

  function menuItems(menu) {
    return [...menu.querySelectorAll("[role='menuitem']:not([disabled])")];
  }

  function initMenus(root) {
    elements(root, "[data-bu-menu]").forEach((trigger) => setup(trigger, "menu", () => {
      const menu = document.querySelector(trigger.dataset.buMenu);
      if (!menu) return;
      const show = (focusIndex) => {
        closeOtherFloating(menu, trigger);
        open(menu, trigger);
        const items = menuItems(menu);
        if (items.length && focusIndex != null) items[focusIndex].focus({ preventScroll: true });
      };
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        menu.hidden ? show(null) : close(menu);
      });
      trigger.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = menuItems(menu);
        show(event.key === "ArrowUp" || event.key === "End" ? items.length - 1 : 0);
      });
      menu.addEventListener("keydown", (event) => {
        const items = menuItems(menu);
        const index = items.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          close(menu);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = items.length - 1;
        items[next].focus();
      });
      menu.addEventListener("click", (event) => {
        if (event.target.closest("[role='menuitem']")) close(menu);
      });
    }));
  }

  function initAlerts(root) {
    elements(root, "[data-bu-alert-dismiss]").forEach((button) => setup(button, "alert", () => {
      button.addEventListener("click", () => {
        const alert = button.closest(".bu-alert");
        if (alert) alert.remove();
      });
    }));
  }

  function initToastTriggers(root) {
    elements(root, "[data-bu-toast-trigger]").forEach((button) => setup(button, "toast-trigger", () => {
      button.addEventListener("click", () => toast({
        title: button.dataset.buToastTitle || "Hinweis",
        message: button.dataset.buToastMessage || "",
        tone: button.dataset.buToastTone || "neutral",
        duration: button.dataset.buToastDuration == null ? 5000 : Number(button.dataset.buToastDuration),
      }));
    }));
  }

  function initNativeStates(root) {
    elements(root, "input[type='checkbox'][data-bu-indeterminate]").forEach((input) => setup(input, "indeterminate", () => {
      input.indeterminate = true;
    }));
  }

  function initPagination(root) {
    elements(root, "[data-bu-pagination]").forEach((pagination) => setup(pagination, "pagination", () => {
      const buttons = [...pagination.querySelectorAll("[data-page]")];
      const statusSelector = pagination.dataset.buStatus;
      const status = statusSelector && document.querySelector(statusSelector);
      const update = (page) => {
        buttons.forEach((button) => {
          const current = Number(button.dataset.page) === page;
          if (current) button.setAttribute("aria-current", "page");
          else button.removeAttribute("aria-current");
        });
        const prev = pagination.querySelector("[data-bu-page='previous']");
        const next = pagination.querySelector("[data-bu-page='next']");
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= buttons.length;
        if (status) status.textContent = `Datensätze ${(page - 1) * 10 + 1}–${page * 10} von ${buttons.length * 10}`;
        pagination.dataset.page = String(page);
      };
      buttons.forEach((button) => button.addEventListener("click", () => update(Number(button.dataset.page))));
      pagination.querySelectorAll("[data-bu-page]").forEach((button) => button.addEventListener("click", () => {
        const current = Number(pagination.dataset.page || 1);
        update(button.dataset.buPage === "previous" ? current - 1 : current + 1);
      }));
      update(Number(pagination.dataset.page || 1));
    }));
  }

  function initSteppers(root) {
    elements(root, "[data-bu-process]").forEach((process) => setup(process, "process", () => {
      const steps = [...process.querySelectorAll(".bu-stepper__item")];
      const controls = process.parentElement.querySelectorAll("[data-bu-step-action]");
      const update = (index) => {
        const bounded = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach((step, stepIndex) => {
          step.dataset.state = stepIndex < bounded ? "complete" : stepIndex === bounded ? "current" : "upcoming";
          step.setAttribute("aria-current", stepIndex === bounded ? "step" : "false");
        });
        process.dataset.step = String(bounded);
      };
      controls.forEach((button) => button.addEventListener("click", () => {
        const current = Number(process.dataset.step || 0);
        update(current + (button.dataset.buStepAction === "next" ? 1 : -1));
      }));
      update(Number(process.dataset.step || 0));
    }));
  }

  function sortValue(row, index, type) {
    const cell = row.cells[index];
    const raw = cell ? (cell.dataset.value || cell.textContent.trim()) : "";
    return type === "number" ? Number(raw.replace(/[^0-9,.-]/g, "").replace(",", ".")) : raw.toLocaleLowerCase("de");
  }

  function initTables(root) {
    elements(root, "[data-bu-sortable]").forEach((table) => setup(table, "table", () => {
      table.querySelectorAll("[data-bu-sort]").forEach((button) => button.addEventListener("click", () => {
        const header = button.closest("th");
        const index = [...header.parentElement.children].indexOf(header);
        const direction = header.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        table.querySelectorAll("th[aria-sort]").forEach((item) => item.setAttribute("aria-sort", "none"));
        header.setAttribute("aria-sort", direction);
        const rows = [...table.tBodies[0].rows];
        const type = button.dataset.buSort || "string";
        rows.sort((a, b) => {
          const av = sortValue(a, index, type);
          const bv = sortValue(b, index, type);
          const result = typeof av === "number" ? av - bv : av.localeCompare(bv, "de");
          return direction === "ascending" ? result : -result;
        });
        rows.forEach((row) => table.tBodies[0].append(row));
      }));
    }));
  }

  function initCatalogNav(root) {
    elements(root, "[data-bu-catalog-nav]").forEach((nav) => setup(nav, "catalog-nav", () => {
      const links = [...nav.querySelectorAll("a[href^='#']")];
      if (!("IntersectionObserver" in window)) return;
      const observed = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        links.forEach((link) => link.setAttribute("aria-current", String(link.getAttribute("href") === `#${visible.target.id}`)));
      }, { rootMargin: "-20% 0px -70%", threshold: [0, 0.2, 0.5] });
      observed.forEach((section) => observer.observe(section));
    }));
  }

  function removeToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.dataset.state = "closing";
    const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
    window.setTimeout(() => toast.remove(), delay);
  }

  function toast(options) {
    const settings = Object.assign({ title: "Hinweis", message: "", tone: "neutral", duration: 5000 }, options);
    const tones = ["neutral", "success", "warning", "danger"];
    if (!tones.includes(settings.tone)) settings.tone = "neutral";
    let region = document.querySelector(".bu-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "bu-toast-region";
      region.setAttribute("aria-label", "Benachrichtigungen");
      region.setAttribute("aria-live", "polite");
      document.body.append(region);
    }

    const item = document.createElement("div");
    item.className = `bu-toast${settings.tone === "neutral" ? "" : ` bu-toast--${settings.tone}`}`;
    item.setAttribute("role", settings.tone === "danger" ? "alert" : "status");
    item.setAttribute("aria-atomic", "true");
    item.dataset.state = "open";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "bu-icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `icons.svg#${settings.tone === "success" ? "check" : settings.tone === "warning" ? "warning" : settings.tone === "danger" ? "error" : "info"}`);
    icon.append(use);
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "bu-toast__title";
    title.textContent = settings.title;
    content.append(title);
    if (settings.message) {
      const message = document.createElement("p");
      message.className = "bu-toast__message";
      message.textContent = settings.message;
      content.append(message);
    }
    const dismiss = document.createElement("button");
    dismiss.className = "bu-icon-button bu-icon-button--quiet bu-icon-button--sm";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Benachrichtigung schließen");
    dismiss.innerHTML = '<svg class="bu-icon" aria-hidden="true"><use href="icons.svg#close"></use></svg>';
    dismiss.addEventListener("click", () => removeToast(item));
    item.append(icon, content, dismiss);
    region.append(item);
    if (Number(settings.duration) > 0) window.setTimeout(() => removeToast(item), Number(settings.duration));
    return item;
  }

  function init(root) {
    const scope = root && (root.querySelectorAll || root instanceof Element) ? root : document;
    initGlobalListeners();
    initOpenClose(scope);
    initTabs(scope);
    initSegmented(scope);
    initSwitches(scope);
    initAccordion(scope);
    initRanges(scope);
    initNumbers(scope);
    initPasswords(scope);
    initSearch(scope);
    initFiles(scope);
    initPopovers(scope);
    initTooltips(scope);
    initMenus(scope);
    initAlerts(scope);
    initToastTriggers(scope);
    initNativeStates(scope);
    initPagination(scope);
    initSteppers(scope);
    initTables(scope);
    initCatalogNav(scope);
    return scope;
  }

  window.BraunUI = Object.freeze({ VERSION, init, open, close, toast });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(document), { once: true });
  } else {
    init(document);
  }
}());
