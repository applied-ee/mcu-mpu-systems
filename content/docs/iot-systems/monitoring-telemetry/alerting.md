---
title: "Alerting"
weight: 30
---

# Alerting

Alerting bridges the gap between passive dashboards and active incident response. A Grafana dashboard showing that 200 devices went offline is useful only if someone happens to be looking at it. An alerting pipeline detects the condition automatically, evaluates whether it warrants human attention, routes the notification to the right team through the right channel, and provides enough context for the responder to act without first spending 20 minutes reconstructing what happened. For IoT fleets, alerting must handle both individual device failures (a single sensor node with a dead battery) and fleet-wide events (a firmware rollout causing boot loops across 5% of devices) — two very different patterns that require different routing, grouping, and suppression strategies.

## Alertmanager Architecture

Prometheus Alertmanager is the standard alert routing and notification component in the Prometheus ecosystem. The pipeline works as follows:

1. **Prometheus evaluates alerting rules** at a configured interval (typically 15–60 seconds). Each rule is a PromQL expression with a threshold condition and a `for` duration that prevents transient spikes from triggering alerts.
2. **Firing alerts are sent to Alertmanager** via HTTP. Each alert carries labels (severity, device_id, site, alert_name) and annotations (summary, description, runbook URL).
3. **Alertmanager routes, groups, deduplicates, and silences alerts** according to its configuration, then sends notifications to receivers (PagerDuty, OpsGenie, Slack, email, webhooks).

A typical Prometheus alerting rule for IoT:

```yaml
groups:
  - name: fleet-alerts
    rules:
      - alert: DeviceBatteryLow
        expr: device_battery_voltage < 3.3
        for: 15m
        labels:
          severity: warning
          category: power
        annotations:
          summary: "Low battery on {{ $labels.device_id }}"
          description: "Battery voltage {{ $value }}V on device {{ $labels.device_id }} at site {{ $labels.site }}"
          runbook_url: "https://wiki.internal/runbooks/low-battery"

      - alert: FleetOfflineSpike
        expr: (count(up{job="iot-devices"} == 0) / count(up{job="iot-devices"})) > 0.05
        for: 5m
        labels:
          severity: critical
          category: connectivity
        annotations:
          summary: "More than 5% of fleet offline"
          description: "{{ $value | humanizePercentage }} of devices are offline"
          runbook_url: "https://wiki.internal/runbooks/fleet-offline"

      - alert: DeviceBootLoop
        expr: increase(device_boot_count[10m]) > 3
        for: 0m
        labels:
          severity: critical
          category: stability
        annotations:
          summary: "Boot loop detected on {{ $labels.device_id }}"
          description: "Device {{ $labels.device_id }} has rebooted {{ $value }} times in 10 minutes"
```

The `for: 15m` clause on `DeviceBatteryLow` requires the voltage to remain below 3.3 V for 15 consecutive minutes before firing. This prevents alerts from momentary voltage sags during radio transmission. The `FleetOfflineSpike` rule uses a ratio — 5% of the fleet — rather than an absolute count, scaling automatically as the fleet grows.

## Route Trees and Notification Routing

Alertmanager's routing configuration determines which alerts go where. Routes form a tree structure where alerts match against label selectors and are sent to the corresponding receiver:

```yaml
route:
  receiver: default-slack
  group_by: ['category', 'site']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: pagerduty-oncall
      group_wait: 10s
      repeat_interval: 1h
      routes:
        - match:
            category: security
          receiver: pagerduty-security
    - match:
        severity: warning
        category: power
      receiver: slack-power-team
      group_by: ['site']
      repeat_interval: 12h
    - match:
        category: stability
      receiver: slack-firmware-team
      group_by: ['firmware']

receivers:
  - name: default-slack
    slack_configs:
      - channel: '#iot-alerts'
        send_resolved: true
  - name: pagerduty-oncall
    pagerduty_configs:
      - service_key: '<PD_SERVICE_KEY>'
  - name: pagerduty-security
    pagerduty_configs:
      - service_key: '<PD_SECURITY_KEY>'
  - name: slack-power-team
    slack_configs:
      - channel: '#iot-power-alerts'
  - name: slack-firmware-team
    slack_configs:
      - channel: '#iot-firmware-alerts'
```

**Grouping** (`group_by`) is critical for IoT fleets. Without grouping, a fleet-wide event that affects 500 devices generates 500 individual notifications. Grouping by `site` consolidates all alerts from the same site into a single notification: "12 devices at warehouse-east have low battery." Grouping by `firmware` consolidates boot loop alerts: "8 devices running firmware 2.3.1 are in boot loops."

**Timing parameters:**
- `group_wait` — How long to buffer alerts before sending the first notification for a new group. 30 seconds collects related alerts that fire within a short window.
- `group_interval` — Minimum time between notifications for the same group when new alerts are added. Prevents a trickle of devices hitting a threshold from generating a notification every few seconds.
- `repeat_interval` — How often to re-send a notification for an unresolved alert group. 4 hours for warnings, 1 hour for critical.

## Fleet-Wide vs. Per-Device Rules

IoT alerting requires two distinct categories of rules that serve different operational purposes:

**Per-device rules** detect individual device failures:
- Battery voltage below threshold
- Temperature above maximum rated
- Boot loop detected
- No heartbeat received in N minutes
- Memory watermark below safe threshold

These rules fire for specific `device_id` values and are routed to engineering teams or device management queues. The alert volume scales linearly with fleet size — a fleet of 10,000 devices with a 1% failure rate generates 100 per-device alerts.

**Fleet-wide rules** detect systemic issues:
- More than N% of devices offline simultaneously
- Average metric (battery voltage, RSSI) crossing a fleet-wide threshold
- Error rate increase correlated with a specific firmware version
- Message ingestion rate dropping below expected baseline
- Sudden increase in OTA update failures

Fleet-wide rules fire once regardless of fleet size and are routed to platform operations or incident management. A single "5% of fleet offline" alert carries more urgency and different response procedures than 500 individual "device offline" alerts.

**Inhibition rules** suppress per-device alerts when a fleet-wide alert is already active:

```yaml
inhibit_rules:
  - source_match:
      alertname: FleetOfflineSpike
    target_match:
      alertname: DeviceOffline
    equal: ['site']
```

This configuration suppresses individual `DeviceOffline` alerts for a site when `FleetOfflineSpike` is already firing for that site. The fleet-wide alert is the actionable signal; the per-device alerts are noise in this context.

## PagerDuty and OpsGenie Integration

For critical alerts that require immediate human response, Alertmanager integrates with incident management platforms:

**PagerDuty:**
- Alerts create incidents via the Events API v2
- Severity mapping: Alertmanager `critical` → PagerDuty `critical`, `warning` → PagerDuty `warning`
- Deduplication key derived from alert labels prevents duplicate incidents for the same ongoing issue
- Auto-resolution: when Prometheus resolves an alert (condition no longer met), Alertmanager sends a resolve event that closes the PagerDuty incident

**OpsGenie:**
- Similar integration via the OpsGenie API
- Supports team-based routing: power alerts to the hardware team, firmware alerts to the embedded team, connectivity alerts to the infrastructure team
- On-call schedule integration ensures the right engineer is paged based on time of day and rotation

**Common configuration for both:**
- Include the `runbook_url` annotation in every alert. The responder receiving a 3 AM page for "FleetOfflineSpike" needs a link to a step-by-step investigation procedure, not just a metric name and threshold value.
- Set appropriate escalation policies: if the primary on-call does not acknowledge within 10 minutes, escalate to the secondary. If unacknowledged after 30 minutes, escalate to the team lead.
- Configure maintenance windows for planned outages. A scheduled cloud migration that takes the MQTT broker offline for 20 minutes should not page the on-call engineer.

## Runbooks

Every alerting rule should link to a runbook — a documented investigation and remediation procedure:

```markdown
# Runbook: FleetOfflineSpike

## Alert condition
More than 5% of fleet devices are offline simultaneously.

## Immediate checks
1. Verify MQTT broker health (connection count, message throughput)
2. Check cloud platform status (AWS IoT Core service health)
3. Check network infrastructure (VPN tunnels, firewall rules, DNS)
4. Identify affected sites (geographic correlation?)
5. Identify affected firmware versions (rollout correlation?)

## Common causes
- MQTT broker overload or crash
- TLS certificate expiration on broker or device fleet
- DNS resolution failure for broker hostname
- Cloud platform regional outage
- Firewall rule change blocking MQTT ports
- OTA rollout causing boot loops on updated devices

## Remediation
- Broker crash: restart and verify connection recovery
- Certificate expiration: deploy renewed certificate, force device reconnection
- Rollout-induced: pause OTA rollout, initiate rollback for affected devices
- Network issue: engage network operations team
```

Runbooks reduce mean time to resolution (MTTR) by eliminating the investigation phase for known failure modes. A well-maintained runbook library turns a 45-minute investigation into a 10-minute checklist.

## Automated Response

Some alert conditions warrant automated remediation without waiting for human intervention:

- **OTA rollout pause** — If boot loop alerts fire for more than N devices running the newly deployed firmware version within M minutes of a rollout, automatically pause the rollout. This prevents a bad firmware update from bricking the entire fleet while the on-call engineer is asleep. Implementation: Alertmanager webhook receiver triggers a CI/CD API call that sets the rollout status to "paused."
- **Log level elevation** — When a device triggers a stability alert (boot loop, crash), automatically send a command via the MQTT device shadow to increase the device's log level to DEBUG for the next 2 hours. This captures diagnostic data for the next crash cycle without manual intervention.
- **Device quarantine** — A device exhibiting anomalous network behavior (unexpected outbound connections, abnormal data volume) is automatically moved to a restricted MQTT ACL that allows only heartbeat and diagnostic topics. This contains potential security incidents while preserving the ability to investigate.

Automated responses require careful guardrails. A false positive that triggers an automated OTA rollout pause delays a legitimate update. A misconfigured quarantine rule that triggers on normal traffic patterns isolates healthy devices. Every automated response should include a manual override mechanism and emit its own alert notifying operators that an automated action was taken.

## Alert Fatigue Management

Alert fatigue — the state where operators ignore or dismiss alerts due to excessive volume or frequent false positives — is the most common failure mode of IoT alerting systems. A fleet of 10,000 devices with poorly tuned thresholds can generate hundreds of alerts per day, each requiring a human to evaluate and dismiss.

**Strategies for reducing alert fatigue:**

- **Tune thresholds based on historical data.** A battery voltage threshold of 3.3 V that fires for 200 devices per week is too sensitive for the fleet's actual battery curve. Analyzing historical voltage distributions and setting the threshold at the 1st percentile (where genuine failures occur) reduces false positives.
- **Use `for` durations aggressively.** Transient threshold crossings (voltage sag during radio transmission, CPU spike during OTA download) fire and resolve within seconds. A `for: 15m` clause eliminates these transient alerts entirely.
- **Group alerts by root cause, not by symptom.** Fifty devices at one site going offline simultaneously is one incident (site outage), not fifty incidents. Grouping by `site` and using fleet-wide rules reduces fifty alerts to one.
- **Silence known conditions.** A batch of devices awaiting battery replacement will fire low-battery alerts repeatedly. Silencing those specific `device_id` values (with an expiration matching the replacement schedule) keeps the alert channel clean for new issues.
- **Review alert volume weekly.** Track the number of alerts fired, acknowledged, and resolved per week. If any single alert name accounts for more than 30% of total alert volume and rarely leads to action, the rule needs tuning or removal.

## Tips

- Start with fewer, broader alerts and add specificity over time. A single "fleet health degraded" alert that fires when any key metric crosses a threshold is more actionable on day one than 30 fine-grained rules that overwhelm the team before they understand normal fleet behavior.
- Include device metadata in alert annotations, not just metric values. An annotation that says "Device sensor-0042 (firmware 2.3.1, site warehouse-east, deployed 2024-03-15) battery at 3.1 V" gives the responder immediate context without requiring a dashboard lookup.
- Test alerting pipelines end-to-end before relying on them in production. Inject a synthetic alert (temporarily lower a threshold to trigger it) and verify it appears in PagerDuty/OpsGenie/Slack with correct formatting, routing, and runbook links. A pipeline that has never fired in production may have a misconfigured receiver or a blocked webhook.
- Set `send_resolved: true` on Slack receivers so operators see both the alert firing and its resolution. Without resolution notifications, the Slack channel accumulates firing alerts with no indication of which have self-resolved, creating a misleading impression of ongoing incidents.

## Caveats

- **Alertmanager's grouping is based on label equality, not semantic similarity.** Two devices at the same site experiencing the same failure mode but with different `device_id` labels are in the same group only if `group_by` includes `site` but not `device_id`. If `group_by` includes `device_id`, every device generates its own group and its own notification — defeating the purpose of grouping. Choose `group_by` labels carefully based on the desired notification granularity.
- **The `for` duration in Prometheus alerting rules delays detection but does not delay resolution.** An alert with `for: 15m` takes 15 minutes to fire but resolves immediately when the condition is no longer met. This asymmetry means dashboards show alerts flapping (firing, resolving, firing) when a metric oscillates around the threshold. Hysteresis (different thresholds for firing and resolving) is not natively supported in Prometheus and requires creative rule design.
- **Alertmanager silences are not version-controlled by default.** Silences created via the Alertmanager UI or API are stored in the Alertmanager process's local state. If Alertmanager restarts without persistent state, all silences are lost. Running Alertmanager with a persistent volume and backing up the silences periodically prevents this, but it is not the default configuration.
- **Webhook-based automated responses (OTA pause, device quarantine) introduce a coupling between the alerting system and the deployment/management system.** If the webhook endpoint is down when the alert fires, the automated response fails silently. Alertmanager retries webhook deliveries, but only for a configured duration. Critical automated responses should use a durable message queue between Alertmanager and the action system rather than a synchronous HTTP webhook.

## In Practice

- **An on-call engineer receiving 40 PagerDuty incidents overnight, all for individual device offline alerts at the same site** indicates a site-level outage that per-device alerting rules detected but failed to aggregate. Adding a `FleetOfflineSpike` rule with inhibition (suppressing per-device alerts when the fleet-wide alert is active) reduces those 40 pages to a single incident with a site-level runbook.
- **Alert volume spiking immediately after a firmware rollout** — particularly stability alerts like boot loops and crash reports — is the signature of a bad update. Correlating the alert timeline with the rollout timeline (annotations in Grafana showing rollout start/pause/complete) confirms causation. If automated rollout pause is configured, the rollout stops automatically; if not, the alert volume itself is the signal to pause manually.
- **A "DeviceBatteryLow" alert firing and resolving repeatedly for the same device every few hours** suggests the device is on the boundary of the threshold — voltage sags below 3.3 V under load (radio transmission) and recovers to 3.4 V at idle. The battery is genuinely near end-of-life, but the flapping alert is noise. Adding hysteresis (fire at 3.3 V, resolve only above 3.5 V) or increasing the `for` duration eliminates the flapping while still catching the genuine low-battery condition.
- **Alertmanager showing zero firing alerts while the Grafana dashboard shows obvious anomalies** usually indicates the alerting rules are not evaluating correctly. Common causes: the Prometheus rule file was not loaded (check Prometheus `/rules` endpoint), the PromQL expression uses a metric name that does not exist (typo or label mismatch), or the `for` duration has not elapsed since the condition started. Prometheus's Alerts page shows pending alerts (condition met but `for` duration not yet satisfied), which narrows the diagnosis.
