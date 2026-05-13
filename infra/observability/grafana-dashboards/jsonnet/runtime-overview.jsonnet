{
  "title": "SFAI Runtime Overview (as-code)",
  "uid": "sfai-runtime-overview-as-code",
  "schemaVersion": 39,
  "version": 1,
  "editable": true,
  "tags": ["sfai", "runtime", "generated"],
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "panels": [
    {
      "id": 1,
      "title": "Error Rate (5m)",
      "type": "timeseries",
      "datasource": {
        "type": "prometheus",
        "uid": "$__DS_PROMETHEUS__"
      },
      "gridPos": {
        "h": 10,
        "w": 12,
        "x": 0,
        "y": 0
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(sfai_tool_executions_total{status=\"error\"}[5m]))"
        }
      ]
    },
    {
      "id": 2,
      "title": "Throughput (5m)",
      "type": "timeseries",
      "datasource": {
        "type": "prometheus",
        "uid": "$__DS_PROMETHEUS__"
      },
      "gridPos": {
        "h": 10,
        "w": 12,
        "x": 12,
        "y": 0
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(sfai_tool_executions_total[5m]))"
        }
      ]
    }
  ]
}
