
exports.handler = async (event) => {
    if (!event.Records) {
        console.log("No SNS records found in this event context.");
        return;
    }

    try {
        for (const record of event.Records) {
            const snsMessageRaw = record.Sns.Message;
            const orderData = JSON.parse(snsMessageRaw);
            const { orderId, status, amount } = orderData;
            console.log(`Processing Email Notification -> Order ID: ${orderId}, Status: ${status}, Amount: ${amount}`);
            console.log(`[EMAIL SENT SUCCESS] Notification message dispatched to customer for order ${orderId}.`);
        }
    } catch (error) {
        console.error("Error parsing event transaction context:", error);
        throw error;
    }
}