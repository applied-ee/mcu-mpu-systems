---
title: "Centralized Logging with ELK"
weight: 10
---

# Centralized Logging with ELK

Embedded devices produce logs that are sparse, irregular, and arrive over constrained links — a fundamentally different ingestion profile than web servers generating gigabytes of access logs per hour. A fleet of 5,000 devices each emitting 50 log entries per day produces roughly 250,000 entries and 50 MB of raw data daily. That volume is modest by cloud-logging standards, but the operational value per entry is high: a single `ERR` log from a remote sensor node may be the only clue to a hardware failure that cannot be reproduced in the lab. Centralized logging infrastructure must ingest these entries reliably, index them for fast search, and retain them long enough to support forensic analysis of failures that may not be investigated for weeks.

## ELK Stack Architecture

The ELK stack — Elasticsearch, Logstash, and Kibana — is the dominant open-source platform for centralized log management. Each component has a specific role in the pipeline:

- **Elasticsearch** — A distributed search and analytics engine built on Apache Lucene. Stores log entries as JSON documents in indices, supports full-text search and structured queries, and scales horizontally by sharding indices across nodes. For IoT workloads, the primary concern is index sizing: each shard carries overhead (heap memory, file descriptors), so creating one index per device is catastrophic at fleet scale. A time-based index strategy (one index per day or per week) with a `device_id` field keeps shard counts manageable.
- **Logstash** — An ingestion pipeline that receives data from sources, transforms it through filters, and routes it to outputs. For IoT, the input is typically an MQTT subscriber plugin or a message queue (Kafka, RabbitMQ) that buffers messages from the MQTT broker. Logstash filters parse structured log entries (JSON, CBOR), enrich them with fleet metadata (device model, firmware version, deployment site), and normalize timestamps before writing to Elasticsearch.
- **Kibana** — A visualization and exploration UI for Elasticsearch. Provides the Discover view for ad-hoc log search, Dashboard for saved visualizations, and Lens for building charts. Kibana Query Language (KQL) enables field-scoped searches like `device_id: "sensor-0042" AND level: "ERR"`.

A minimal production deployment runs three Elasticsearch nodes (for quorum and replica allocation), one Logstash instance, and one Kibana instance. For fleets under 10,000 devices at typical IoT log volumes, this fits on three 4-core, 16 GB RAM machines with SSD storage.

## MQTT-to-Logstash Ingestion

The bridge between device telemetry and the logging pipeline is a Logstash input that subscribes to log topics on the MQTT broker:

```yaml
# logstash-iot-logs.conf
input {
  mqtt {
    host => "mqtt-broker.internal"
    port => 8883
    ssl => true
    topic => "devices/+/logs"
    client_id => "logstash-log-ingest"
    qos => 1
  }
}

filter {
  json {
    source => "message"
  }
  mutate {
    rename => { "ts" => "device_timestamp" }
    rename => { "lvl" => "log_level" }
    rename => { "mod" => "module" }
    rename => { "msg" => "log_message" }
  }
  # Extract device_id from MQTT topic
  grok {
    match => { "topic" => "devices/%{DATA:device_id}/logs" }
  }
  date {
    match => [ "device_timestamp", "UNIX" ]
    target => "device_time"
  }
}

output {
  elasticsearch {
    hosts => ["https://es-node-1:9200", "https://es-node-2:9200"]
    index => "iot-logs-%{+YYYY.MM.dd}"
    user => "logstash_writer"
    password => "${ES_PASSWORD}"
  }
}
```

The `qos => 1` setting ensures at-least-once delivery from the broker to Logstash. Duplicate messages are possible but acceptable for log entries — Elasticsearch handles idempotent writes if an `_id` field is derived from the device ID and device-side sequence number. The wildcard topic `devices/+/logs` subscribes to logs from all devices without requiring per-device configuration.

For higher throughput or when backpressure handling is critical, inserting Apache Kafka between the MQTT broker and Logstash decouples ingestion from indexing. The MQTT broker publishes to a Kafka topic via a bridge connector, and Logstash reads from Kafka at its own pace. This buffers log entries during Elasticsearch maintenance windows or indexing slowdowns without losing data or exerting backpressure on the MQTT broker.

## Index Lifecycle Management

Elasticsearch indices grow continuously. Without lifecycle management, storage fills, queries slow down, and cluster health degrades. Index Lifecycle Management (ILM) automates the progression of indices through phases:

- **Hot phase** — Active write index. Receives all incoming log entries. Stored on fast SSDs with the highest replica count (typically 1 replica for IoT volumes). Rolls over to a new index when it reaches a size threshold (50 GB) or age threshold (1 day for high-volume fleets, 7 days for low-volume).
- **Warm phase** — Read-only index. No longer receiving writes. Can be force-merged to reduce segment count and shrunk to fewer shards. Moved to cheaper storage (HDDs or lower-tier cloud volumes). Typical duration: 30 days.
- **Cold phase** — Infrequently accessed index. Searchable but slow. Can use searchable snapshots (Elasticsearch 7.10+) to reduce local storage requirements. Typical duration: 90–365 days.
- **Delete phase** — Index is permanently removed. For IoT fleets with compliance requirements (GDPR data retention limits, HIPAA audit trails), the delete phase timing is dictated by policy, not storage cost alone.

An ILM policy for a typical IoT deployment:

```json
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50gb",
            "max_age": "7d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "freeze": {}
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

## KQL Search Patterns for IoT Logs

Kibana Query Language (KQL) provides a concise syntax for searching IoT logs. Common query patterns:

- **All errors from a specific device:** `device_id: "sensor-0042" AND log_level: "ERR"`
- **Wi-Fi association failures across the fleet:** `module: "wifi" AND log_message: "assoc fail"`
- **OTA update failures in the last 24 hours:** `module: "ota" AND log_level: "ERR" AND log_message: "update*fail*"`
- **Devices reporting low memory:** `module: "heap" AND log_message: "free heap below*"`
- **All logs from a specific firmware version:** `firmware_version: "2.3.1" AND log_level: ("ERR" OR "WARN")`

Saved searches enable fleet operators to build a library of diagnostic queries. Combining saved searches with Kibana alerts creates automated detection — an alert fires when the count of OTA update failures exceeds a threshold within a time window.

For time-range analysis, Elasticsearch's date histogram aggregation groups log entries into buckets (hourly, daily) and reveals patterns: a spike in error logs every day at 03:00 UTC may correlate with a scheduled cloud-side maintenance window or a cron job that overloads a shared database.

## Grafana Loki as an Alternative

Grafana Loki provides a lighter-weight approach to log aggregation that trades full-text indexing for label-based filtering:

- **Index strategy** — Loki indexes only metadata labels (device_id, log_level, firmware_version, deployment_site), not the log content itself. This dramatically reduces storage and memory requirements compared to Elasticsearch. A Loki deployment handling the same 50 MB/day from 5,000 devices requires roughly one-tenth the infrastructure of an equivalent ELK stack.
- **LogQL** — Loki's query language filters by labels first, then applies regex or pattern matching to the log content. Example: `{device_id="sensor-0042", log_level="ERR"} |= "assoc fail"` returns error logs from a specific device containing the string "assoc fail."
- **Storage backends** — Loki stores log chunks in object storage (S3, GCS, MinIO) with a small index in BoltDB or Cassandra. Object storage pricing ($0.023/GB/month on S3) makes long-term retention affordable. The 50 MB/day example costs roughly $0.42/year for storage — negligible compared to the compute cost of running the Loki instance.
- **Grafana integration** — Loki appears as a native data source in Grafana, enabling log panels alongside metric panels (from Prometheus or InfluxDB) on the same dashboard. Correlating a spike in error logs with a drop in a Prometheus metric (e.g., MQTT message throughput) on a single screen accelerates root-cause analysis.

The tradeoff: Loki cannot perform arbitrary full-text search across all log content without scanning chunks. Queries that filter by known labels are fast; queries that search for an arbitrary string across all devices and all time ranges are slow. For IoT workloads where most searches filter by device_id, deployment_site, or firmware_version first, this tradeoff is often acceptable.

## Sizing and Capacity Planning

Sizing a centralized logging deployment for IoT requires estimating ingestion rate, storage growth, and query load:

| Parameter | Small fleet | Medium fleet | Large fleet |
|-----------|------------|-------------|------------|
| Devices | 1,000 | 10,000 | 100,000 |
| Logs per device per day | 50 | 50 | 50 |
| Raw log volume per day | 10 MB | 100 MB | 1 GB |
| Elasticsearch storage (with index overhead, 2x raw) | 20 MB/day | 200 MB/day | 2 GB/day |
| 90-day retention | 1.8 GB | 18 GB | 180 GB |
| Elasticsearch heap (minimum) | 1 GB | 4 GB | 16 GB |

These estimates assume typical IoT log entries averaging 200 bytes each. Devices in debug mode (temporarily elevated log level) produce 10–100x more entries. Capacity planning must account for diagnostic bursts — investigating a fleet-wide issue may temporarily elevate 5–10% of devices to debug logging, increasing ingestion by 5–50x for hours.

Elasticsearch shard sizing follows the rule of thumb: 10–50 GB per shard, no more than 20 shards per GB of heap. For the medium fleet example with daily rollover, each daily index is roughly 200 MB — small enough for a single shard. Weekly rollover (1.4 GB per index) is equally manageable and reduces shard proliferation.

## Tips

- Use the MQTT topic structure to extract metadata without parsing the log payload. A topic like `devices/{device_id}/logs/{level}` lets Logstash extract both the device ID and log level from the topic path, reducing the complexity of filter pipelines and enabling topic-level filtering at the broker for selective ingestion.
- Set a maximum log entry size at the Logstash filter stage (e.g., truncate entries longer than 4 KB). A firmware bug that logs a full buffer dump or hex dump of a flash sector in a single entry can create multi-megabyte log messages that choke the indexing pipeline.
- Create index templates with explicit field mappings rather than relying on Elasticsearch's dynamic mapping. Dynamic mapping guesses field types from the first document — if the first `device_timestamp` value happens to look like a string, all subsequent timestamps for that index are stored as strings and cannot be used in range queries.
- Deploy a lightweight log shipper (Filebeat or Fluent Bit) on the MQTT-to-Elasticsearch bridge host rather than running Logstash directly on that machine. Filebeat handles backpressure gracefully by slowing reads when Elasticsearch cannot keep up, while a monolithic Logstash pipeline may drop messages under pressure.

## Caveats

- **Elasticsearch is memory-hungry relative to the data volumes typical of IoT log workloads.** A three-node cluster with 16 GB heap per node is the minimum for production reliability, yet the actual data stored may be only a few gigabytes. The overhead-to-data ratio is unfavorable for small fleets — running a full ELK stack for 500 devices and 5 MB of logs per day is architecturally sound but operationally expensive for what amounts to a text file.
- **Device-side timestamp unreliability propagates into log search confusion.** Devices without NTP or with drifting RTCs produce timestamps that are minutes or hours off. A log entry timestamped 14:00 device time may arrive at Logstash at 14:07 server time. Using server-side arrival time as the primary timestamp ensures chronological ordering in Kibana but loses information about the actual sequence of events on the device. Storing both timestamps and defaulting Kibana views to the server timestamp is a common compromise.
- **Index-per-device architectures do not scale.** Creating a separate Elasticsearch index for each device seems logical for isolation but creates thousands of shards, each consuming heap memory and file descriptors. At 1,000 devices, the cluster spends more resources managing shard metadata than serving queries. Time-based indices with a `device_id` field and filtered views are the standard approach.
- **Log ingestion pipelines without backpressure handling lose data silently.** If Logstash cannot write to Elasticsearch (cluster full, node down, slow indexing), messages from the MQTT broker queue up in memory. When the queue fills, messages are dropped. Without a durable buffer (Kafka, Redis, or persistent queues in Logstash), those log entries are gone permanently — often the exact entries needed to diagnose the incident that caused the Elasticsearch outage.

## In Practice

- **A fleet showing a sudden spike in `ERR`-level logs across dozens of devices simultaneously** often indicates a backend-side change rather than a device-side failure. A cloud endpoint returning 503 errors, a certificate expiration causing TLS handshake failures, or a broker configuration change that rejects certain topic patterns all manifest as coordinated error bursts in the log timeline. Filtering by `module` field narrows the source — if all errors come from the `mqtt` or `tls` module, the issue is connectivity; if from `sensor` or `adc`, it points to environmental or hardware causes.
- **Log search returning zero results for a device known to be online** typically means the log ingestion pipeline is lagging or the device's log level is set to `WARN`/`ERR` and no warnings or errors have occurred. Checking the Logstash monitoring metrics (events in vs. events out, pipeline latency) distinguishes ingestion lag from absence of log data. A device operating normally at `WARN` level may legitimately produce zero log entries for days.
- **Kibana dashboards showing log volume dropping to zero overnight for battery-powered outdoor deployments** reflects devices entering deep sleep when solar charging stops. This is normal operational behavior, not a logging pipeline failure. Correlating log volume charts with fleet-wide battery voltage trends confirms the pattern — log volume drops as average battery voltage falls below the sleep-mode threshold.
- **Elasticsearch cluster health turning yellow after weeks of stable operation** usually means a daily index rolled over and the new index's replica shard could not be allocated — often because disk watermarks have been reached on one or more nodes. IoT log retention policies that delete old indices free storage, but if the delete phase has not triggered yet (e.g., 365-day retention), storage grows monotonically. Monitoring cluster disk usage and adjusting ILM timing prevents yellow-health surprises.
