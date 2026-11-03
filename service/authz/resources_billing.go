package authz

const (
	ResourceBilling = "billing"

	ActionModelPricing = "model_pricing"
)

var (
	BillingModelPricing = Permission{Resource: ResourceBilling, Action: ActionModelPricing}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceBilling,
		LabelKey: "Billing & Payment",
		Actions: []ActionDefinition{
			{
				Action:         ActionModelPricing,
				LabelKey:       "Model Pricing",
				DescriptionKey: "Open Billing & Payment model pricing, edit model prices, and add or delete models.",
			},
		},
	})
}
