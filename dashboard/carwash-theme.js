const projectId = new URLSearchParams(location.search).get("project") || "";

if (projectId.endsWith("_carwash")) {
  document.body.classList.add("carwashDashboard");

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", "#0f766e");

  const style = document.createElement("style");
  style.id = "carwashDashboardTheme";
  style.textContent = `
    body.carwashDashboard{
      background:linear-gradient(180deg,#f0fdfa 0%,#ecfdf5 100%);
      color:#134e4a;
    }
    body.carwashDashboard .dashboardHeader{
      background:linear-gradient(135deg,#0f766e,#115e59);
      box-shadow:0 18px 40px rgba(15,118,110,.22);
    }
    body.carwashDashboard .card,
    body.carwashDashboard .statCard,
    body.carwashDashboard .orderCard{
      border-color:#ccfbf1;
    }
    body.carwashDashboard .quickCard,
    body.carwashDashboard .marketingCard,
    body.carwashDashboard .visualMarketingBox{
      background:linear-gradient(180deg,#ffffff,#f0fdfa);
      border-color:#ccfbf1;
    }
    body.carwashDashboard .primaryBtn,
    body.carwashDashboard .tabBtn.active{
      background:linear-gradient(135deg,#0f766e,#115e59);
      color:#fff;
      box-shadow:0 8px 18px rgba(15,118,110,.18);
    }
    body.carwashDashboard .secondaryBtn,
    body.carwashDashboard .primaryMarketing,
    body.carwashDashboard .navItem.active,
    body.carwashDashboard .marketingBadge{
      background:#ccfbf1;
      color:#0f766e;
    }
    body.carwashDashboard .projectLinkBox input:focus,
    body.carwashDashboard .fieldGroup input:focus,
    body.carwashDashboard .searchBox input:focus,
    body.carwashDashboard .marketingSelect:focus,
    body.carwashDashboard .marketingMessageGroup textarea:focus{
      border-color:#2dd4bf;
      box-shadow:0 0 0 4px rgba(20,184,166,.10);
    }
    body.carwashDashboard .orderPrice{
      color:#0f766e;
    }
    body.carwashDashboard .status-accepted{
      background:#0f766e;
    }
    body.carwashDashboard .orderInfo,
    body.carwashDashboard .emptyState,
    body.carwashDashboard .searchBox{
      background:#f0fdfa;
    }
    body.carwashDashboard .orderAction.maps,
    body.carwashDashboard .orderAction.accept{
      background:#ccfbf1;
      color:#0f766e;
    }
    body.carwashDashboard .orderAction.done{
      background:#d1fae5;
      color:#065f46;
    }
    body.carwashDashboard .revenueStat{
      background:linear-gradient(135deg,#134e4a,#115e59);
    }
    body.carwashDashboard .visualBadge{
      background:#134e4a;
    }
    body.carwashDashboard #carwashSubscriptionsPanel{
      background:linear-gradient(180deg,#ffffff,#f0fdfa);
      border:1px solid #99f6e4;
    }
    body.carwashDashboard .carwashSubscriptionCard{
      border:1px solid #99f6e4;
      box-shadow:0 10px 24px rgba(15,118,110,.08);
    }
  `;
  document.head.appendChild(style);
}
