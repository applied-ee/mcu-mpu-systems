---
title: "Time-Series Databases"
weight: 40
---

# Time-Series Databases

Time-series databases (TSDBs) are purpose-built for storing and querying timestamped data: sensor readings, device metrics, event counters, and environmental measurements that arrive continuously and are almost always queried by time range. Relational databases can store time-series data, but they struggle with the write throughput, compression ratios, and time-range query performance that IoT workloads demand. A fleet of 10,000 devices reporting 8 metrics every 60 seconds generates 480,000 writes per minute — a sustained write load that requires storage engines optimized for append-heavy, rarely-updated data with natural time-based partitioning.

The three most common TSDBs for IoT telemetry are InfluxDB (purpose-built, OSS and cloud), TimescaleDB (PostgreSQL extension), and Amazon Timestream (serverless, AWS-native). Each makes different tradeoffs between operational complexity, query language, scalability, and cost.

## InfluxDB

InfluxDB is the most widely deployed open-source time-series database for IoT. Its data model, ingestion protocol, and query capabilities are designed specifically for metrics and events.

### Line Protocol

InfluxDB uses line protocol for data ingestion — a text-based format optimized for write throughput:

```
device_telemetry,device_id=sensor-0042,site=warehouse-east,firmware=2.3.1 battery_voltage=3.82,cpu_usage=34.2,temperature=28.5,free_heap=14832i,rssi=-67i 1709312400000000000
```

Structure: `measurement,tag_key=tag_value field_key=field_value timestamp`

- **Measurement** — Equivalent to a table name. `device_telemetry` groups all device metrics.
- **Tags** — Indexed metadata for filtering and grouping: `device_id`, `site`, `firmware`. Tags are strings and are indexed — queries filtering by tag are fast.
- **Fields** — The actual metric values: `battery_voltage`, `cpu_usage`. Fields are not indexed — queries filtering by field value require a full scan of the matching time range.
- **Timestamp** — Nanosecond-precision Unix timestamp.

The tag vs. field distinction is critical for performance. Placing high-cardinality values (device_id with 10,000 unique values) in tags creates 10,000 series per measurement. Placing a metric value that should be a field into a tag (e.g., `battery_voltage=3.82` as a tag) creates a new series for every unique voltage reading — a cardinality explosion that degrades write and query performance.

### TSM Storage Engine

InfluxDB's Time-Structured Merge Tree (TSM) engine is optimized for time-series write patterns:

- **Write-ahead log (WAL)** — Incoming writes are appended to the WAL for durability, then batched in memory.
- **Cache** — In-memory buffer holding recent writes. When the cache reaches a threshold (25 MB default), it is flushed to a TSM file on disk.
- **TSM files** — Columnar, compressed, immutable files. Each column (field) is compressed using type-specific algorithms: run-length encoding for timestamps, Gorilla compression for floating-point values, simple8b for integers. Compression ratios of 10:1 to 20:1 are typical for IoT telemetry.
- **Compaction** — Background process that merges smaller TSM files into larger ones, improving query performance by reducing the number of files scanned per query.

### Continuous Queries and Downsampling

Raw data at 60-second resolution is essential for recent troubleshooting but wasteful for long-term storage. Continuous queries (InfluxDB 1.x) or tasks (InfluxDB 2.x/3.x) pre-aggregate data on a schedule:

```sql
-- InfluxDB 1.x continuous query: 1-hour averages
CREATE CONTINUOUS QUERY cq_hourly ON iot_metrics
BEGIN
  SELECT mean(battery_voltage), mean(cpu_usage), mean(temperature),
         min(battery_voltage) AS battery_min, max(temperature) AS temp_max
  INTO iot_metrics_hourly.autogen.:MEASUREMENT
  FROM device_telemetry
  GROUP BY time(1h), device_id, site
END
```

A typical retention and downsampling strategy:

| Resolution | Retention | Storage per 10K devices |
|-----------|-----------|------------------------|
| 60-second raw | 7 days | ~2.5 GB |
| 5-minute averages | 30 days | ~2.1 GB |
| 1-hour averages | 1 year | ~1.3 GB |
| 1-day averages | indefinite | ~50 MB/year |

This tiered approach keeps the active dataset small (recent high-resolution data for debugging) while preserving long-term trends at reduced resolution and cost.

### Flux and InfluxQL

InfluxDB supports two query languages:

- **InfluxQL** (SQL-like, InfluxDB 1.x default):
  ```sql
  SELECT mean("battery_voltage") FROM "device_telemetry"
  WHERE "site" = 'warehouse-east' AND time > now() - 24h
  GROUP BY time(1h), "device_id"
  ```

- **Flux** (functional, InfluxDB 2.x):
  ```flux
  from(bucket: "iot_metrics")
    |> range(start: -24h)
    |> filter(fn: (r) => r._measurement == "device_telemetry")
    |> filter(fn: (r) => r.site == "warehouse-east")
    |> aggregateWindow(every: 1h, fn: mean)
  ```

Flux is more expressive (supports joins, custom functions, alerting logic) but has a steeper learning curve. InfluxDB 3.x (IOx engine) returns to SQL as the primary query language, backed by Apache Arrow and DataFusion.

## TimescaleDB

TimescaleDB extends PostgreSQL with time-series optimizations, providing the full power of SQL while addressing the performance limitations of vanilla PostgreSQL for append-heavy, time-range workloads.

### Hypertables

A hypertable is a TimescaleDB abstraction that automatically partitions a PostgreSQL table by time (and optionally by a space dimension like `device_id`):

```sql
CREATE TABLE device_telemetry (
    time        TIMESTAMPTZ NOT NULL,
    device_id   TEXT NOT NULL,
    site        TEXT,
    firmware    TEXT,
    battery_voltage  DOUBLE PRECISION,
    cpu_usage        DOUBLE PRECISION,
    temperature      DOUBLE PRECISION,
    free_heap        INTEGER,
    rssi             INTEGER
);

SELECT create_hypertable('device_telemetry', 'time',
    chunk_time_interval => INTERVAL '1 day');

-- Optional: add space partitioning for large fleets
SELECT add_dimension('device_telemetry', 'device_id',
    number_partitions => 16);
```

Each chunk is a separate PostgreSQL table covering a time interval. Queries that filter by time range only scan the relevant chunks, providing orders-of-magnitude speedup over unpartitioned tables. The `chunk_time_interval` should balance chunk count against chunk size — 1-day chunks for high-volume fleets, 7-day chunks for smaller deployments.

### Compression

TimescaleDB's native compression converts row-oriented chunks into columnar format with type-specific compression:

```sql
ALTER TABLE device_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress chunks older than 7 days automatically
SELECT add_compression_policy('device_telemetry', INTERVAL '7 days');
```

Compression ratios of 10:1 to 20:1 are typical for IoT numeric data. The `segmentby` column determines compression grouping — compressing by `device_id` means each device's data is stored contiguously, making per-device time-range queries efficient on compressed data. Compressed chunks are read-only; inserting late-arriving data into a compressed chunk requires decompression first, which TimescaleDB handles transparently but with a performance penalty.

### Continuous Aggregates

TimescaleDB's continuous aggregates are materialized views that automatically refresh as new data arrives:

```sql
CREATE MATERIALIZED VIEW device_telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    site,
    avg(battery_voltage) AS avg_battery,
    min(battery_voltage) AS min_battery,
    avg(cpu_usage) AS avg_cpu,
    max(temperature) AS max_temp,
    avg(rssi) AS avg_rssi
FROM device_telemetry
GROUP BY bucket, device_id, site;

-- Refresh policy: update hourly aggregates every hour
SELECT add_continuous_aggregate_policy('device_telemetry_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');
```

The `start_offset` handles late-arriving data — data points that arrive up to 3 hours late are included in the aggregate refresh. This is particularly relevant for IoT devices with intermittent connectivity that buffer telemetry locally and transmit backlogs when they reconnect.

### SQL Advantage

TimescaleDB's PostgreSQL foundation provides capabilities that purpose-built TSDBs lack:

- **JOINs** — Correlate telemetry with a device registry table, a site metadata table, or an OTA deployment history table, all in a single SQL query.
- **Full SQL** — Window functions, CTEs, subqueries, and the entire PostgreSQL ecosystem of extensions (PostGIS for geospatial queries on device locations, pg_cron for scheduled maintenance).
- **Existing tooling** — Any tool that speaks PostgreSQL (psql, pgAdmin, SQLAlchemy, JDBC) works with TimescaleDB without adapters or custom drivers.

## Amazon Timestream

Amazon Timestream is a serverless, fully managed TSDB within the AWS ecosystem. It requires no infrastructure provisioning and scales automatically.

### Architecture

Timestream separates storage into two tiers:

- **Memory store** — Recent data (configurable, typically 1–24 hours) held in memory for fast writes and queries. Ingestion throughput scales automatically.
- **Magnetic store** — Historical data stored on cost-optimized magnetic storage. Data automatically migrates from memory store to magnetic store based on the configured retention period. Queries that span both tiers are handled transparently.

### Data Model

Timestream uses a dimensional model similar to InfluxDB's tag/field distinction:

- **Dimensions** — Indexed metadata: `device_id`, `site`, `firmware`. Equivalent to InfluxDB tags.
- **Measures** — Metric values: `battery_voltage`, `cpu_usage`. Each write record contains a measure name, value, and type.
- **Time** — Microsecond-precision timestamp.

Multi-measure records (multiple metrics in a single write) reduce write costs and improve query performance compared to single-measure records.

### Pricing Model

Timestream pricing is consumption-based:

- **Writes** — $0.50 per million writes (1 KB per write). A fleet of 10,000 devices writing 8 metrics every 60 seconds (using multi-measure records, ~480,000 writes/minute) costs approximately $345/month for writes alone.
- **Memory store** — $0.036 per GB-hour. Storing 24 hours of data for the above fleet (~1 GB) costs approximately $0.86/day.
- **Magnetic store** — $0.03 per GB/month. One year of downsampled data (~5 GB) costs $0.15/month.
- **Queries** — $0.01 per GB scanned. Dashboard queries scanning recent data are inexpensive; full-fleet historical queries scanning compressed magnetic-store data can become significant.

For small fleets (under 1,000 devices), Timestream's serverless model eliminates operational overhead at a cost comparable to running a self-managed TSDB. For large fleets (50,000+ devices), the per-write cost can exceed the cost of self-managed InfluxDB or TimescaleDB on equivalent compute.

## Retention and Downsampling Strategies

Regardless of TSDB choice, managing data lifecycle is essential for controlling storage costs and query performance:

- **Raw retention** — Keep full-resolution data for 7–30 days. This window covers the typical investigation period for most incidents. Extending raw retention beyond 30 days is rarely justified by query patterns but doubles storage costs.
- **Downsampled retention** — Aggregate to 5-minute or 1-hour resolution for 90 days to 1 year. Pre-computed aggregates (mean, min, max, count) cover trend analysis and capacity planning use cases.
- **Archive** — Export daily or weekly aggregates to object storage (S3, GCS) for indefinite retention at minimal cost. Parquet format preserves columnar efficiency for analytical queries.
- **Compliance-driven retention** — Some industries require retaining raw telemetry for specific periods (HIPAA: 6 years, IEC 62443: varies by security level). Compliance requirements override cost-optimal retention strategies.

## Schema Design: Wide vs. Narrow

Two fundamental approaches to organizing IoT metrics in a TSDB:

**Narrow schema** — One row per metric per timestamp:

| time | device_id | metric_name | value |
|------|-----------|-------------|-------|
| 10:00 | sensor-42 | battery_voltage | 3.82 |
| 10:00 | sensor-42 | cpu_usage | 34.2 |
| 10:00 | sensor-42 | temperature | 28.5 |

- Flexible: adding a new metric requires no schema change
- More rows: 8 metrics per device per interval means 8x the row count
- Cross-metric queries (correlating battery and temperature) require self-joins

**Wide schema** — One row per device per timestamp with all metrics as columns:

| time | device_id | battery_voltage | cpu_usage | temperature | free_heap | rssi |
|------|-----------|----------------|-----------|-------------|-----------|------|
| 10:00 | sensor-42 | 3.82 | 34.2 | 28.5 | 14832 | -67 |

- Compact: one row per device per interval
- Cross-metric queries are natural: `WHERE battery_voltage < 3.3 AND temperature > 60`
- Schema changes required when adding new metrics (ALTER TABLE)

For IoT telemetry where the metric set per device type is relatively stable (8–15 metrics per device model), the wide schema is more efficient in both storage and query performance. The narrow schema suits environments where metric definitions change frequently or vary significantly across device types.

## Tips

- Use batch writes instead of per-metric individual writes. InfluxDB's line protocol accepts multiple lines per HTTP request; TimescaleDB benefits from `COPY` or multi-row `INSERT` statements. Batching 100–1,000 data points per write request reduces network overhead and improves TSDB write throughput by 5–10x compared to individual inserts.
- Align the TSDB's time partitioning interval with the most common query range. If most dashboard queries cover the last 24 hours, a 1-day partition interval means those queries touch exactly one partition. If most queries cover the last 7 days, a 7-day interval reduces partition scanning.
- Tag every data point with firmware version and hardware revision at write time, not only in a separate registry. Downsampled data that loses the association with firmware version (because the registry has been updated since the original write) cannot support queries like "average battery drain by firmware version over the last 6 months."
- Test downsampled query accuracy before discarding raw data. A 1-hour average of battery voltage hides the voltage sag during radio transmission — the very event that per-device alerting monitors. Retaining min/max alongside the mean in downsampled aggregates preserves visibility into transient extremes.

## Caveats

- **Late-arriving data complicates time-based partitioning and downsampling.** A device that buffers 6 hours of telemetry due to a connectivity outage and then transmits the backlog inserts data into partitions or time buckets that may already be compacted, downsampled, or migrated to cold storage. InfluxDB handles late writes transparently (at a compaction cost). TimescaleDB requires decompressing chunks to accept late inserts. Timestream rejects writes older than the memory store retention window unless magnetic store writes are explicitly enabled.
- **High tag/dimension cardinality is the primary performance killer for TSDBs.** InfluxDB's series cardinality limit, Prometheus's active series limit, and TimescaleDB's chunk proliferation all degrade under high cardinality. A `device_id` tag with 100,000 unique values is unavoidable and manageable with proper resource sizing. Adding a `session_id` or `message_id` tag with millions of unique values causes catastrophic performance degradation — those identifiers belong in logs or traces, not in metric tags.
- **TSDB compression assumes sorted, regular time-series data.** Random inserts, out-of-order data, and irregular sampling intervals reduce compression ratios significantly. A device that reports every 60 seconds achieves 15:1 compression. A device that reports at random intervals (10 seconds, then 3 minutes, then 45 seconds) may only achieve 5:1. The storage impact is modest for one device but meaningful at fleet scale.
- **Serverless TSDBs (Timestream) introduce query cost uncertainty.** A developer running an ad-hoc query that scans 100 GB of historical data incurs a $1.00 query charge. A dashboard with 12 panels refreshing every 30 seconds, each scanning 1 GB, costs $0.12 per minute — $5.18 per hour per viewer. Cost controls (query scan limits, access controls on wide-range queries) are operationally necessary.

## In Practice

- **A Grafana dashboard showing gaps in a device's temperature time series every few hours** often indicates the device entering deep sleep and not reporting during sleep periods, rather than data loss. Grafana's "connect null values" option draws a line through the gaps, which misrepresents the data — the device was not measuring temperature during sleep. Using "null as null" (no line through gaps) accurately represents the data but looks broken to operators unfamiliar with the device's sleep schedule. Adding annotations at sleep/wake transitions clarifies the display.
- **TimescaleDB query performance degrading over weeks despite stable data volume** typically indicates chunk proliferation — too many small chunks from an overly aggressive partition interval. A 1-hour partition interval for a fleet generating 200 MB/day creates 24 chunks per day, 168 per week, and 720 per month. Queries spanning 30 days touch 720 chunks. Increasing the interval to 1 day reduces this to 30 chunks for the same query, dramatically improving planner and executor performance.
- **InfluxDB reporting "max-values-per-tag limit exceeded" for the `device_id` tag** indicates the fleet has grown beyond the configured cardinality limit (default 100,000 in InfluxDB OSS). This is a safety mechanism, not a hard architectural limit. Increasing the limit (with appropriate memory provisioning) or sharding across multiple InfluxDB instances by site or device group resolves the immediate issue.
- **Cost analysis showing that Timestream write charges exceed the cost of running a 3-node TimescaleDB cluster** is common for fleets above 20,000 devices with 60-second reporting intervals. The operational simplicity of Timestream (no patching, no backup management, no capacity planning) offsets the higher unit cost for many teams. The crossover point depends on team size and operational maturity — a two-person IoT team may rationally pay 3x the infrastructure cost to avoid managing a database cluster.
