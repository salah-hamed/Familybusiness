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

function currentStep(journey) {
  return journey.steps[firstCurrentIndex(journey)] || journey.steps[0] || null;
}

function dismissalKey(journey) {
  const step = currentStep(journey);
  return step
    ? "fb-guide-dismissed:" + journey.id + ":" + step.id
    : "fb-guide-dismissed:" + journey.id;
}

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none"
    && style.visibility !== "hidden"
    && element.getClientRects().length > 0;
}

function findTarget(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find(isVisible) || null;
}

function targetAnchor(target) {
  if (!target) return null;

  if (target.matches("button, input, select, textarea, a")) {
    return target.closest(
      ".linkBox, .projectCard, .subscriptionCard, .referralCard, .auth-card, label, section, .card"
    ) || target.parentElement || target;
  }

  return target;
}

function fallbackHost() {
  return document.querySelector("main, .container, .auth-card, .shell") || document.body;
}

export function createGuide(initialJourney, { autoOpen = true } = {}) {
  ensureGuideStyles();

  let journey = initialJourney;
  let activeTarget = null;
  let enabled = autoOpen;

  const root = document.createElement("div");
  root.className = "fbGuideRoot";
  root.innerHTML = [
    '<section class="fbGuideInline" aria-live="polite">',
      '<div class="fbGuideTopline">',
        '<span class="fbGuideEyebrow">خطوتك الحالية</span>',
        '<span class="fbGuideProgressText"></span>',
      '</div>',
      '<div class="fbGuideProgressTrack"><span class="fbGuideProgressBar"></span></div>',
      '<div class="fbGuideMain">',
        '<span class="fbGuideStepNumber"></span>',
        '<div class="fbGuideCopy">',
          '<h2 class="fbGuideTitle"></h2>',
          '<p class="fbGuideDescription"></p>',
        '</div>',
      '</div>',
      '<div class="fbGuideActions">',
        '<button class="fbGuideAction" type="button"></button>',
        '<button class="fbGuideRoadmapToggle" type="button" aria-expanded="false">عرض الرحلة كاملة</button>',
        '<button class="fbGuideDismiss" type="button">إخفاء التوجيه</button>',
      '</div>',
      '<div class="fbGuideRoadmap" hidden>',
        '<p class="fbGuideIntro"></p>',
        '<div class="fbGuideSteps" role="list"></div>',
        '<p class="fbGuidePrivacy">التوجيه مبني على حالة حسابك ومشروعك الحالية — بدون AI وبدون إرسال بيانات إضافية.</p>',
      '</div>',
    '</section>'
  ].join("");

  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "fbGuideHelp";
  helpButton.textContent = "؟ مساعدة";
  helpButton.hidden = true;
  document.body.appendChild(helpButton);

  const inline = root.querySelector(".fbGuideInline");
  const eyebrow = root.querySelector(".fbGuideEyebrow");
  const progressText = root.querySelector(".fbGuideProgressText");
  const progressBar = root.querySelector(".fbGuideProgressBar");
  const stepNumber = root.querySelector(".fbGuideStepNumber");
  const title = root.querySelector(".fbGuideTitle");
  const description = root.querySelector(".fbGuideDescription");
  const actionBtn = root.querySelector(".fbGuideAction");
  const roadmapToggle = root.querySelector(".fbGuideRoadmapToggle");
  const dismissBtn = root.querySelector(".fbGuideDismiss");
  const roadmap = root.querySelector(".fbGuideRoadmap");
  const intro = root.querySelector(".fbGuideIntro");
  const stepsBox = root.querySelector(".fbGuideSteps");

  function clearTarget() {
    if (activeTarget) activeTarget.classList.remove("fbGuideTarget");
    activeTarget = null;
  }

  function highlightTarget(step, { scroll = false } = {}) {
    clearTarget();
    const target = findTarget(step?.selector || "");
    if (!target) return false;

    activeTarget = target;
    target.classList.add("fbGuideTarget");

    if (scroll) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }

  function mountNearStep(step) {
    const target = findTarget(step?.selector || "");
    const anchor = targetAnchor(target);

    if (anchor && anchor.parentNode && anchor !== root && !root.contains(anchor)) {
      anchor.parentNode.insertBefore(root, anchor);
      return;
    }

    const host = fallbackHost();
    if (host === root || root.contains(host)) return;

    if (host.firstChild) host.insertBefore(root, host.firstChild);
    else host.appendChild(root);
  }

  function isDismissed() {
    try {
      return localStorage.getItem(dismissalKey(journey)) === "1";
    } catch {
      return false;
    }
  }

  function setDismissed(value) {
    try {
      if (value) localStorage.setItem(dismissalKey(journey), "1");
      else localStorage.removeItem(dismissalKey(journey));
    } catch {
      // Local storage is optional. The guide still works without persistence.
    }
  }

  function renderRoadmap() {
    stepsBox.replaceChildren();

    journey.steps.forEach((step, index) => {
      const row = document.createElement("div");
      row.className = "fbGuideStep status-" + (step.status || "pending");
      row.setAttribute("role", "listitem");

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
          ? "أنت هنا"
          : "بعدها";

      copy.append(heading, state);
      row.append(marker, copy);
      stepsBox.appendChild(row);
    });
  }

  function executeAction(step) {
    if (!step) return;

    if (step.href) {
      window.location.href = step.href;
      return;
    }

    highlightTarget(step, { scroll: true });
  }

  function show({ scroll = false, clearDismissal = false } = {}) {
    const step = currentStep(journey);
    if (!step) return;

    if (clearDismissal) setDismissed(false);

    root.hidden = false;
    helpButton.hidden = true;
    mountNearStep(step);
    highlightTarget(step, { scroll });

    if (scroll) {
      root.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function hide({ remember = true } = {}) {
    if (remember) setDismissed(true);
    root.hidden = true;
    helpButton.hidden = false;
    clearTarget();
  }

  function render({ reveal = enabled } = {}) {
    const step = currentStep(journey);
    if (!step) {
      root.hidden = true;
      helpButton.hidden = true;
      clearTarget();
      return;
    }

    const currentIndex = firstCurrentIndex(journey);
    const doneCount = journey.steps.filter(item => item.status === "done").length;
    const total = Math.max(1, journey.steps.length);

    eyebrow.textContent = step.status === "current" ? "خطوتك الحالية" : "دليل الاستخدام";
    progressText.textContent = "خطوة " + (currentIndex + 1) + " من " + total + " • " + doneCount + " مكتملة";
    progressBar.style.width = Math.round((doneCount / total) * 100) + "%";
    stepNumber.textContent = String(currentIndex + 1);
    title.textContent = step.title;
    description.textContent = step.description;
    intro.textContent = journey.intro || "";

    const hasAction = Boolean(step.href || step.selector);
    actionBtn.hidden = !hasAction;
    actionBtn.textContent = step.actionLabel || (step.href ? "كمّل الخطوة" : "روح للجزء المطلوب");

    renderRoadmap();
    mountNearStep(step);

    if (reveal && !isDismissed()) {
      show();
    } else {
      root.hidden = true;
      helpButton.hidden = !reveal;
      clearTarget();
    }
  }

  roadmapToggle.addEventListener("click", () => {
    const expanded = roadmap.hidden;
    roadmap.hidden = !expanded;
    roadmapToggle.setAttribute("aria-expanded", String(expanded));
    roadmapToggle.textContent = expanded ? "إخفاء تفاصيل الرحلة" : "عرض الرحلة كاملة";
  });

  actionBtn.addEventListener("click", () => executeAction(currentStep(journey)));
  dismissBtn.addEventListener("click", () => hide({ remember: true }));
  helpButton.addEventListener("click", () => show({ scroll: true, clearDismissal: true }));

  render({ reveal: enabled });

  return {
    open() {
      enabled = true;
      show({ scroll: true, clearDismissal: true });
    },
    close() {
      hide({ remember: true });
    },
    update(nextJourney, { autoOpen: shouldAutoOpen = true } = {}) {
      clearTarget();
      journey = nextJourney;
      enabled = shouldAutoOpen;
      roadmap.hidden = true;
      roadmapToggle.setAttribute("aria-expanded", "false");
      roadmapToggle.textContent = "عرض الرحلة كاملة";
      render({ reveal: shouldAutoOpen });
    }
  };
}
