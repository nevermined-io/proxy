import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'

export const OTEL_SERVICE_NAMESPACE = process.env.OTEL_SERVICE_NAMESPACE
const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'oauth-server'

export const initializeMetrics = (debug: boolean = false) => {
  // debugging
  if (debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  }

  const meterProvider = new MeterProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: OTEL_SERVICE_NAME,
    }),
  })

  const metricExporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    headers: {
      authorization: process.env.OTEL_EXPORTER_OTLP_METRICS_AUTHORIZATION,
    },
  })
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    // export metrics every 60secs
    exportIntervalMillis: 60000,
  })

  meterProvider.addMetricReader(metricReader)
  metrics.setGlobalMeterProvider(meterProvider)
}
