import { handleMetricaMeasurement, readMetricaMeasurementConfig } from '@/lib/metrica-measurement';

export const runtime = 'nodejs';
export function POST(request: Request) {
  return handleMetricaMeasurement(request, readMetricaMeasurementConfig());
}
