function ensureGuideStyles() {
  if (document.querySelector('link[data-fb-guide-style="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./guide.css", import.meta.url).href;
  link.dataset.fbGuideStyle = "true";
  document.head.appendChild(link);
}

function firstCurrentIndex(journey) {
  const index = journey.steps.findIndex(step => step.status === "current");
  return index >= 0 ? index : 0;
}

function seenKey(journey) {
  const current = journey.steps.find(step => step.status === "current");
  return current ? `fb-guide-seen:${journey.id}:${current.id}` : `fb-guide-seen:${journey.id}`;
}

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function findTarget(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find(isVisible) || null;
}

export function createGuide(initialJourney, { autoOpen = true } = {}) {
  ensureGuideStyles();

  let journey = initialJourney;
  let activeIndex = firstCurrentIndex(journey);
  let activeTarget = null;

  const root = document.createElement("div");
  root.className = "fbGuideRoot";
  root.innerHTML = `
    <button class="fbGuideLauncher" type="button" aria-expanded="false">
      <span class="fbGuideLauncherDot"></span>
      <span>إيه الخطوة الجاية؟</span>
    </button>
    <aside class="fbGuidePanel" aria-hidden="true" aria-label="دليل استخدام Family Business">
      <div class="fbGuideHeader">
        <div>
          <span class="fbGuideEyebrow">Family Business Guide</span>
          <h2 class="fbGuideTitle"></h2>
        </div>
        <button class="fbGuideClose" type="button" aria-label="إغلاق الدليل">×</button>
      </div>
      <p class="fbGuideIntro"></p>
      <div class="fbGuideProgress">
        <span class="fbGuideProgressText"></span>
        <div class="fbGuideProgressTrack"><span class="fbGuideProgressBar"></span></div>
      </div>
      <div class="fbGuideSteps" role="list"></div>
      <div class="fbGuideFocusCard">
        <span class="fbGuideFocusNumber"></span>
        <div>
          <strong class="fbGuideFocusTitle"></strong>
          <p class="fbGuideFocusDescription"></p>
        </div>
      </div>
      <div class="fbGuideActions">
        <button class="fbGuidePrev" type="button">السابق</button>
        <button class="fbGuideAction" type="button"></button>
        <button class="fbGuideNext" type="button">التالي</button>
      </div>
      <p class="fbGuidePrivacy">التوجيه يعمل من حالة حسابك الحالية فقط — بدون AI وبدون إرسال بيانات إضافية.</p>
    </aside>
  `;
  document.body.appendChild(root);

  const launcher = root.querySelector(".fbGuideLauncher");
  const panel = root.querySelector(".fbGuidePanel");
  const closeBtn = root.querySelector(".fbGuideClose");
  const title = root.querySelector(".fbGuideTitle");
  const intro = root.querySelector(".fbGuideIntro");
  const progressText = root.querySelector(".fbGuideProgressText");
  const progressBar = root.querySelector(".fbGuideProgressBar");
  const stepsBox = root.querySelector(".fbGuideSteps");
  const focusNumber = root.querySelector(".fbGuideFocusNumber");
  const focusTitle = root.querySelector(".fbGuideFocusTitle");
  const focusDescription = root.querySelector(".fbGuideFocusDescription");
  const prevBtn = root.querySelector(".fbGuidePrev");
  const nextBtn = root.querySelector(".fbGuideNext");
  const actionBtn = root.querySelector(".fbGuideAction");

  function clearTarget() {
    if (activeTarget) activeTarget.classList.remove("fbGuideTarget");
    activeTarget = null;
  }

  function focusTarget(step) {
    clearTarget();
    const target = findTarget(step.selector);
    if (!target) return false;
    activeTarget = target;
    target.classList.add("fbGuideTarget");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  function executeAction(step) {
    if (step.href) {
      window.location.href = step.href;
      return;
    }
    focusTarget(step);
  }

  function renderFocus() {
    const step = journey.steps[activeIndex] || journey.steps[0];
    if (!step) return;
    focusNumber.textContent = `${activeIndex + 1}`;
    focusTitle.textContent = step.title;
    focusDescription.textContent = step.description;
    prevBtn.disabled = activeIndex <= 0;
    nextBtn.disabled = activeIndex >= journey.steps.length - 1;

    const hasAction = Boolean(step.href || step.selector);
    actionBtn.hidden = !hasAction;
    actionBtn.textContent = step.actionLabel || (step.href ? "كمّل الخطوة" : "ورّيني مكانها");

    [...stepsBox.querySelectorAll(".fbGuideStep")].forEach((button, index) => {
      button.classList.toggle("is-selected", index === activeIndex);
    });
  }

  function render() {
    title.textContent = journey.title;
    intro.textContent = journey.intro || "";

    const doneCount = journey.steps.filter(step => step.status === "done").length;
    const total = Math.max(1, journey.steps.length);
    progressText.textContent = `${doneCount} من ${total} خطوات مكتملة`;
    progressBar.style.width = `${Math.round((doneCount / total) * 100)}%`;

    stepsBox.replaceChildren();
    journey.steps.forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `fbGuideStep status-${step.status || "pending"}`;
      button.setAttribute("role", "listitem");

      const marker = document.createElement("span");
      marker.className = "fbGuideStepMarker";
      marker.textContent = step.status === "done" ? "✓" : String(index + 1);

      const copy = document.createElement("span");
      copy.className = "fbGuideStepCopy";

      const heading = document.createElement("strong");
      heading.textContent = step.title;
      const state = document.createElement("small");
      state.textContent = step.status === "done"
        ? "تم"
        : step.status === "current"
          ? "الخطوة الحالية"
          : "بعدها";

      copy.append(heading, state);
      button.append(marker, copy);
      button.addEventListener("click", () => {
        activeIndex = index;
        renderFocus();
        if (step.selector) focusTarget(step);
      });
      stepsBox.appendChild(button);
    });

    renderFocus();
  }

  function open({ focusCurrent = false } = {}) {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.setAttribute("aria-expanded", "true");
    if (focusCurrent) {
      const step = journey.steps[activeIndex];
      if (step?.selector) focusTarget(step);
    }
  }

  function close() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    launcher.setAttribute("aria-expanded", "false");
    clearTarget();
  }

  function maybeAutoOpen(force = false, enabled = autoOpen) {
    if (!force && !enabled) return;
    const key = seenKey(journey);
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(key) === "1";
      if (!alreadySeen) localStorage.setItem(key, "1");
    } catch {
      alreadySeen = false;
    }
    if (!alreadySeen || force) {
      requestAnimationFrame(() => open());
    }
  }

  launcher.addEventListener("click", () => {
    if (panel.classList.contains("is-open")) close();
    else open();
  });
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => {
    activeIndex = Math.max(0, activeIndex - 1);
    renderFocus();
  });
  nextBtn.addEventListener("click", () => {
    activeIndex = Math.min(journey.steps.length - 1, activeIndex + 1);
    renderFocus();
  });
  actionBtn.addEventListener("click", () => executeAction(journey.steps[activeIndex]));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
  });

  render();
  maybeAutoOpen(false);

  return {
    open,
    close,
    update(nextJourney, { autoOpen: shouldAutoOpen = true } = {}) {
      clearTarget();
      journey = nextJourney;
      activeIndex = firstCurrentIndex(journey);
      render();
      if (shouldAutoOpen) maybeAutoOpen(false, true);
    }
  };
}
