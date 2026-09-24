export const TEMPLATE_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  DRAFT: "draft"
});

export const TEMPLATE_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  HIDDEN: "hidden"
});

export const OPERATING_MODEL = Object.freeze({
  OWNER: "owner_operated",
  PARTNER: "partner_operated"
});

const projects = [
  {
    id: "supermarket",
    templateId: "supermarket",
    title: "توصيل السوبرماركت",
    description: "اربط سوبرماركت واحد بمشروعك، وساعده في استقبال وإدارة طلبات التوصيل مقابل عمولة متفق عليها لكل طلب مكتمل.",
    icon: "🛒",
    color: "#16A34A",
    folder: "supermarket",
    status: TEMPLATE_STATUS.ACTIVE,
    visibility: TEMPLATE_VISIBILITY.PUBLIC,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 1,
    sortOrder: 1,
    isFeatured: true,
    creationEnabled: true
  },
  {
    id: "cleaning",
    templateId: "cleaning",
    title: "تنظيف المنازل",
    description: "المشروع محفوظ داخل المنصة لكنه متوقف مؤقتًا لحين استكمال خطة الإطلاق.",
    icon: "🧹",
    color: "#4F46E5",
    folder: "cleaning",
    status: TEMPLATE_STATUS.PAUSED,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.OWNER,
    version: 1,
    sortOrder: 90,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "restaurant",
    templateId: "restaurant",
    title: "طلبات المطاعم",
    description: "اربط مطعمًا واحدًا بمشروعك، واترك له تخصيص هويته ومنيو الطعام والأسعار وإدارة الطلبات والتوصيل مقابل عمولة متفق عليها لكل طلب مكتمل.",
    icon: "🍽️",
    color: "#EA580C",
    folder: "restaurant",
    status: TEMPLATE_STATUS.ACTIVE,
    visibility: TEMPLATE_VISIBILITY.PUBLIC,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 1,
    sortOrder: 2,
    isFeatured: true,
    creationEnabled: true
  },
  {
    id: "laundry",
    templateId: "laundry",
    title: "غسيل وكي الملابس",
    description: "اربط مغسلة واحدة بالمشروع، واترك لها تشغيل الاستلام والغسيل والتوصيل مقابل عمولة متفق عليها لكل طلب مكتمل.",
    icon: "👕",
    color: "#0EA5E9",
    folder: "laundry",
    status: TEMPLATE_STATUS.ACTIVE,
    visibility: TEMPLATE_VISIBILITY.PUBLIC,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 3,
    sortOrder: 3,
    isFeatured: false,
    creationEnabled: true
  },
  {
    id: "carwash",
    templateId: "carwash",
    title: "غسيل السيارات",
    description: "المشروع محفوظ وجاهز داخل المنصة لكنه متوقف مؤقتًا لحين اعتماد نموذج التشغيل النهائي.",
    icon: "🚗",
    color: "#0F766E",
    folder: "carwash",
    status: TEMPLATE_STATUS.PAUSED,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.OWNER,
    version: 1,
    sortOrder: 90,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "hall",
    templateId: "hall",
    title: "حجز قاعات الأفراح",
    icon: "💍",
    color: "#EC4899",
    folder: "hall",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 0,
    sortOrder: 101,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "maintenance",
    templateId: "maintenance",
    title: "صيانة المنازل",
    icon: "🔧",
    color: "#F97316",
    folder: "maintenance",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 0,
    sortOrder: 102,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "salon",
    templateId: "salon",
    title: "كوافير منزلي",
    icon: "💇",
    color: "#8B5CF6",
    folder: "salon",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 0,
    sortOrder: 103,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "dress",
    templateId: "dress",
    title: "تأجير الفساتين",
    icon: "👗",
    color: "#E11D48",
    folder: "dress",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 0,
    sortOrder: 104,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "tanks",
    templateId: "tanks",
    title: "تنظيف خزانات المياه",
    icon: "🚰",
    color: "#06B6D4",
    folder: "tanks",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.OWNER,
    version: 0,
    sortOrder: 105,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "pest",
    templateId: "pest",
    title: "مكافحة الحشرات",
    icon: "🐜",
    color: "#84CC16",
    folder: "pest",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.OWNER,
    version: 0,
    sortOrder: 106,
    isFeatured: false,
    creationEnabled: false
  },
  {
    id: "moving",
    templateId: "moving",
    title: "نقل الأثاث",
    icon: "📦",
    color: "#F59E0B",
    folder: "moving",
    status: TEMPLATE_STATUS.DRAFT,
    visibility: TEMPLATE_VISIBILITY.HIDDEN,
    operatingModel: OPERATING_MODEL.PARTNER,
    version: 0,
    sortOrder: 107,
    isFeatured: false,
    creationEnabled: false
  }
];

export function isTemplatePublic(project) {
  return project?.visibility === TEMPLATE_VISIBILITY.PUBLIC;
}

export function isTemplateActive(project) {
  return project?.status === TEMPLATE_STATUS.ACTIVE;
}

export function isTemplateDiscoverable(project) {
  return isTemplatePublic(project) && isTemplateActive(project);
}

export function canCreateTemplate(project) {
  return isTemplateDiscoverable(project) && project?.creationEnabled === true;
}

export function getDiscoverableProjects() {
  return projects
    .filter(isTemplateDiscoverable)
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
}

export function getProjectDefinition(templateId) {
  return projects.find(project => project.id === templateId) || null;
}

export default projects;
