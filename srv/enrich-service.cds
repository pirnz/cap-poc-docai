@cds.server.body_parser.limit: '50mb'
service EnrichService @(path: '/enrich') {
  @open
  action callback(payload: LargeString) returns String;
}
