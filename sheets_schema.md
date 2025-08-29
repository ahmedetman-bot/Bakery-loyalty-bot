# Google Sheets Schema

## Settings
| Key              | Value | Notes |
|------------------|-------|-------|
| EGP_PER_POINT    | 50    | EGP per 1 point |
| DAILY_PIN        | 1234  | 4 digits, rotate daily |
| MIN_BILL         | 70    | Minimum bill to earn points |
| DAILY_POINT_CAP  | 8     | Max points per day per customer |

## Customers
| Phone | Name | Tier | Points | JoinedAt |

## Txns
| Phone | DateTime | Bill | PointsAdded | InvoiceRef | Cashier | DailyPIN | Note |

## Rewards
| Id | Title | CostPoints | Description |
