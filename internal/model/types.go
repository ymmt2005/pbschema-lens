package model

// SchemaModel is the JSON document the browser renders.
type SchemaModel struct {
	Title       string             `json:"title"`
	Packages    []*DocPackage      `json:"packages"`
	Files       []*DocFile         `json:"files"`
	Messages    []*DocMessage      `json:"messages"`
	Fields      []*DocField        `json:"fields"`
	Oneofs      []*DocOneof        `json:"oneofs"`
	Enums       []*DocEnum         `json:"enums"`
	EnumValues  []*DocEnumValue    `json:"enumValues"`
	Services    []*DocService      `json:"services"`
	Methods     []*DocMethod       `json:"methods"`
	Extensions  []*DocExtension    `json:"extensions"`
	Symbols     map[string]any     `json:"symbols"`
	ByFullName  map[string]string  `json:"byFullName"`
	SymbolIndex []SymbolIndexEntry `json:"symbolIndex"`
	BuildInfo   BuildInfo          `json:"buildInfo"`
	WKTNotes    map[string]string  `json:"wktNotes"`
	Diff        *SchemaDiff        `json:"diff,omitempty"`
}

type BuildInfo struct {
	Title       string         `json:"title"`
	GeneratedAt string         `json:"generatedAt"`
	Generator   string         `json:"generator"`
	Input       string         `json:"input"`
	Commit      string         `json:"commit,omitempty"`
	Repository  string         `json:"repository,omitempty"`
	SymbolCount int            `json:"symbolCount"`
	FileCount   int            `json:"fileCount"`
	Timings     map[string]int `json:"timings"`
	Warnings    []string       `json:"warnings"`
}

type SymbolIndexEntry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	FullName string `json:"fullName"`
	Kind     string `json:"kind"`
	Package  string `json:"package"`
	URLPath  string `json:"urlPath"`
}

type DocComment struct {
	Leading      string   `json:"leading,omitempty"`
	Trailing     string   `json:"trailing,omitempty"`
	Detached     []string `json:"detached"`
	MarkdownHTML string   `json:"markdownHtml"`
}

type SourceLocation struct {
	FileName    string `json:"fileName"`
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
}

type SourceLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type SymbolReference struct {
	Kind   string `json:"kind"`
	FromID string `json:"fromId"`
	ToID   string `json:"toId"`
	Label  string `json:"label,omitempty"`
}

type Semantic struct {
	RendererID string   `json:"rendererId"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	Details    string   `json:"details,omitempty"`
	Badges     []string `json:"badges,omitempty"`
}

type DocOption struct {
	Name         string      `json:"name"`
	FullName     string      `json:"fullName"`
	Number       int32       `json:"number,omitempty"`
	Extension    bool        `json:"extension"`
	BuiltIn      bool        `json:"builtIn"`
	Target       string      `json:"target"`
	DefinitionID string      `json:"definitionId,omitempty"`
	Value        OptionValue `json:"value"`
	TextProto    string      `json:"textProto"`
	Semantic     *Semantic   `json:"semantic,omitempty"`
}

type OptionValue struct {
	Kind        string
	Scalar      string
	Value       any
	EnumType    string
	Name        string
	Number      int32
	TypeName    string
	Fields      []OptionField
	TextProto   string
	Values      []OptionValue
	Entries     []OptionMapEntry
	Base64      string
	FieldNumber int32
	WireType    int
	Note        string
}

type OptionField struct {
	Name      string
	Number    int32
	Extension bool
	Value     OptionValue
}

type OptionMapEntry struct {
	Key   string
	Value OptionValue
}

type EffectiveFeature struct {
	Name          string `json:"name"`
	Declared      string `json:"declared,omitempty"`
	Effective     string `json:"effective"`
	Source        string `json:"source"`
	InheritedFrom string `json:"inheritedFrom,omitempty"`
}

type baseSymbol struct {
	ID             string             `json:"id"`
	Kind           string             `json:"kind"`
	FullName       string             `json:"fullName"`
	ShortName      string             `json:"shortName"`
	PackageName    string             `json:"packageName"`
	FileName       string             `json:"fileName"`
	Domain         string             `json:"domain"`
	GeneratePage   bool               `json:"generatePage"`
	InNav          bool               `json:"inNav"`
	Deprecated     bool               `json:"deprecated"`
	Comments       *DocComment        `json:"comments,omitempty"`
	Source         *SourceLocation    `json:"source,omitempty"`
	SourceLink     *SourceLink        `json:"sourceLink,omitempty"`
	RepositoryLink *SourceLink        `json:"repositoryLink,omitempty"`
	Options        []*DocOption       `json:"options"`
	References     []SymbolReference  `json:"references"`
	ReferencedBy   []SymbolReference  `json:"referencedBy"`
	URLPath        string             `json:"urlPath"`
	Anchor         string             `json:"anchor,omitempty"`
	Features       []EffectiveFeature `json:"features"`
}

type DocPackage struct {
	baseSymbol
	ServiceIDs   []string `json:"serviceIds"`
	MessageIDs   []string `json:"messageIds"`
	EnumIDs      []string `json:"enumIds"`
	ExtensionIDs []string `json:"extensionIds"`
	FileIDs      []string `json:"fileIds"`
}

type DocFile struct {
	baseSymbol
	Syntax              string   `json:"syntax"`
	Edition             string   `json:"edition,omitempty"`
	DependencyIDs       []string `json:"dependencyIds"`
	PublicDependencyIDs []string `json:"publicDependencyIds"`
	GoPackage           string   `json:"goPackage,omitempty"`
	JavaPackage         string   `json:"javaPackage,omitempty"`
	CsharpNamespace     string   `json:"csharpNamespace,omitempty"`
	SourceText          string   `json:"sourceText,omitempty"`
}

type ReservedRange struct {
	Start int32 `json:"start"`
	End   int32 `json:"end"`
}

type DocMessage struct {
	baseSymbol
	ParentID           string          `json:"parentId,omitempty"`
	FieldIDs           []string        `json:"fieldIds"`
	OneofIDs           []string        `json:"oneofIds"`
	NestedMessageIDs   []string        `json:"nestedMessageIds"`
	NestedEnumIDs      []string        `json:"nestedEnumIds"`
	NestedExtensionIDs []string        `json:"nestedExtensionIds"`
	ExtensionRanges    []ReservedRange `json:"extensionRanges"`
	ReservedRanges     []ReservedRange `json:"reservedRanges"`
	ReservedNames      []string        `json:"reservedNames"`
	MapEntry           bool            `json:"mapEntry"`
	ExampleJSON        any             `json:"exampleJson,omitempty"`
	ExampleTextProto   string          `json:"exampleTextProto,omitempty"`
}

type TypeRef struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	ID          string `json:"id,omitempty"`
	URLPath     string `json:"urlPath,omitempty"`
	ExternalURL string `json:"externalUrl,omitempty"`
}

type DocField struct {
	baseSymbol
	ParentID     string   `json:"parentId"`
	Number       int32    `json:"number"`
	JSONName     string   `json:"jsonName"`
	Cardinality  string   `json:"cardinality"`
	Type         TypeRef  `json:"type"`
	MapKey       *TypeRef `json:"mapKey,omitempty"`
	MapValue     *TypeRef `json:"mapValue,omitempty"`
	OneofID      string   `json:"oneofId,omitempty"`
	Packed       *bool    `json:"packed,omitempty"`
	DefaultValue string   `json:"defaultValue,omitempty"`
	Presence     string   `json:"presence"`
}

type DocOneof struct {
	baseSymbol
	ParentID string   `json:"parentId"`
	FieldIDs []string `json:"fieldIds"`
}

type DocEnum struct {
	baseSymbol
	ParentID       string          `json:"parentId,omitempty"`
	Open           bool            `json:"open"`
	AllowAlias     bool            `json:"allowAlias"`
	ValueIDs       []string        `json:"valueIds"`
	ReservedRanges []ReservedRange `json:"reservedRanges"`
	ReservedNames  []string        `json:"reservedNames"`
}

type DocEnumValue struct {
	baseSymbol
	ParentID string `json:"parentId"`
	Number   int32  `json:"number"`
}

type DocService struct {
	baseSymbol
	MethodIDs []string `json:"methodIds"`
}

type DocMethod struct {
	baseSymbol
	ParentID        string  `json:"parentId"`
	Input           TypeRef `json:"input"`
	Output          TypeRef `json:"output"`
	ClientStreaming bool    `json:"clientStreaming"`
	ServerStreaming bool    `json:"serverStreaming"`
	StreamingKind   string  `json:"streamingKind"`
	Idempotency     string  `json:"idempotency,omitempty"`
	Signature       string  `json:"signature"`
}

type DocExtension struct {
	baseSymbol
	Number       int32   `json:"number"`
	Extendee     TypeRef `json:"extendee"`
	Type         TypeRef `json:"type"`
	OptionTarget string  `json:"optionTarget,omitempty"`
	Declaration  string  `json:"declaration"`
}

type SymbolChange struct {
	ID       string   `json:"id"`
	FullName string   `json:"fullName"`
	Kind     string   `json:"kind"`
	Change   string   `json:"change"`
	Details  []string `json:"details"`
}

type SchemaDiff struct {
	AgainstLabel string         `json:"againstLabel"`
	Added        []SymbolChange `json:"added"`
	Removed      []SymbolChange `json:"removed"`
	Modified     []SymbolChange `json:"modified"`
	Breaking     []any          `json:"breaking"`
}
