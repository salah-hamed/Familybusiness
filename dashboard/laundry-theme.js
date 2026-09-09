const projectId = new URLSearchParams(location.search).get("project") || "";

if (projectId.endsWith("_laundry")) {
  document.body.classList.add("laundryDashboard");

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", "#0ea5e9");

  const style = document.createElement("style");
  style.id = "laundryDashboardTheme";
  style.textContent = `
    body.laundryDashboard{
      background:linear-gradient(180deg,#f0f9ff 0%,#e0f2fe 100%);
      color:#0f172a;
    }
    body.laundryDashboard .dashboardHeader{
      background:linear-gradient(135deg,#0ea5e9,#0369a1);
      box-shadow:0 18px 40px rgba(3,105,161,.20);
    }
    body.laundryDashboard .card,
    body.laundryDashboard .statCard,
    body.laundryDashboard .orderCard{
      border-color:#bae6fd;
    }
    body.laundryDashboard .quickCard,
    body.laundryDashboard .marketingCard,
    body.laundryDashboard .visualMarketingBox,
    body.laundryDashboard #laundryPricingPanel{
      background:linear-gradient(180deg,#ffffff,#f0f9ff);
      border-color:#bae6fd;
    }
    body.laundryDashboard .primaryBtn,
    body.laundryDashboard .tabBtn.active{
      background:linear-gradient(135deg,#0ea5e9,#0369a1);
      color:#fff;
      box-shadow:0 8px 18px rgba(3,105,161,.16);
    }
    body.laundryDashboard .secondaryBtn,
    body.laundryDashboard .navItem.active,
    body.laundryDashboard .marketingBadge,
    body.laundryDashboard .primaryMarketing{
      background:#e0f2fe;
      color:#0369a1;
    }
    body.laundryDashboard .projectLinkBox input:focus,
    body.laundryDashboard .fieldGroup input:focus,
    body.laundryDashboard .searchBox input:focus,
    body.laundryDashboard .marketingSelect:focus,
    body.laundryDashboard .marketingMessageGroup textarea:focus{
      border-color:#38bdf8;
      box-shadow:0 0 0 4px rgba(14,165,233,.10);
    }
    body.laundryDashboard .orderPrice{color:#0284c7;}
    body.laundryDashboard .orderInfo,
    body.laundryDashboard .emptyState,
    body.laundryDashboard .searchBox{background:#f0f9ff;}
    body.laundryDashboard .orderAction.maps,
    body.laundryDashboard .orderAction.accept{
      background:#e0f2fe;
      color:#0369a1;
    }
    body.laundryDashboard .orderAction.done{
      background:#dbeafe;
      color:#075985;
    }
    body.laundryDashboard .revenueStat{
      background:linear-gradient(135deg,#075985,#0369a1);
    }
    body.laundryDashboard .visualBadge{background:#075985;}
  `;
  document.head.appendChild(style);
}
