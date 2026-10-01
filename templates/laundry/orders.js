import {
  createLaundryOrder,
  getLaundryOrderTracking,
  subscribeLaundryOrderTracking
} from "../../core/laundry/order-service.js";

export async function createOrder(orderData) {
  try {
    const result = await createLaundryOrder(orderData);
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error.message || "تعذر إرسال الطلب.",
      code: error.code || "unknown"
    };
  }
}

export { getLaundryOrderTracking, subscribeLaundryOrderTracking };
