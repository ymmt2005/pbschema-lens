package model

import "sort"

// Diff compares two models built from descriptor sets.
func Diff(current, previous *SchemaModel, againstLabel string) *SchemaDiff {
	cur := map[string]*baseSymbol{}
	prev := map[string]*baseSymbol{}
	for id, symbol := range current.Symbols {
		if base, ok := basePtr(symbol); ok {
			cur[id] = base
		}
	}
	for id, symbol := range previous.Symbols {
		if base, ok := basePtr(symbol); ok {
			prev[id] = base
		}
	}
	diff := &SchemaDiff{AgainstLabel: againstLabel, Breaking: []any{}}
	for id, symbol := range cur {
		if _, ok := prev[id]; !ok {
			diff.Added = append(diff.Added, SymbolChange{
				ID: id, FullName: symbol.FullName, Kind: symbol.Kind, Change: "added",
				Details: []string{"Added " + symbol.Kind + " " + symbol.FullName},
			})
		}
	}
	for id, symbol := range prev {
		if _, ok := cur[id]; !ok {
			diff.Removed = append(diff.Removed, SymbolChange{
				ID: id, FullName: symbol.FullName, Kind: symbol.Kind, Change: "removed",
				Details: []string{"Removed " + symbol.Kind + " " + symbol.FullName},
			})
		}
	}
	for id, now := range cur {
		then, ok := prev[id]
		if !ok {
			continue
		}
		details := describeChange(current, previous, id, now, then)
		if len(details) == 0 {
			continue
		}
		diff.Modified = append(diff.Modified, SymbolChange{
			ID: id, FullName: now.FullName, Kind: now.Kind, Change: "modified", Details: details,
		})
	}
	sortChanges(diff.Added)
	sortChanges(diff.Removed)
	sortChanges(diff.Modified)
	if diff.Added == nil {
		diff.Added = []SymbolChange{}
	}
	if diff.Removed == nil {
		diff.Removed = []SymbolChange{}
	}
	if diff.Modified == nil {
		diff.Modified = []SymbolChange{}
	}
	return diff
}

func describeChange(current, previous *SchemaModel, id string, now, then *baseSymbol) []string {
	var details []string
	if now.Deprecated != then.Deprecated {
		if now.Deprecated {
			details = append(details, "Marked deprecated")
		} else {
			details = append(details, "Deprecation removed")
		}
	}
	if now.Kind == "field" {
		a, _ := current.Symbols[id].(*DocField)
		b, _ := previous.Symbols[id].(*DocField)
		if a != nil && b != nil {
			if a.Number != b.Number {
				details = append(details, "Field number "+itoa(b.Number)+" → "+itoa(a.Number))
			}
			if a.Type.Name != b.Type.Name {
				details = append(details, "Type "+b.Type.Name+" → "+a.Type.Name)
			}
			if a.Cardinality != b.Cardinality {
				details = append(details, "Cardinality "+b.Cardinality+" → "+a.Cardinality)
			}
			if a.JSONName != b.JSONName {
				details = append(details, "JSON name "+b.JSONName+" → "+a.JSONName)
			}
		}
	}
	if now.Kind == "enum-value" {
		a, _ := current.Symbols[id].(*DocEnumValue)
		b, _ := previous.Symbols[id].(*DocEnumValue)
		if a != nil && b != nil && a.Number != b.Number {
			details = append(details, "Number "+itoa(b.Number)+" → "+itoa(a.Number))
		}
	}
	if now.Kind == "message" {
		a, _ := current.Symbols[id].(*DocMessage)
		b, _ := previous.Symbols[id].(*DocMessage)
		if a != nil && b != nil {
			prevFields := map[string]bool{}
			for _, id := range b.FieldIDs {
				prevFields[id] = true
			}
			curFields := map[string]bool{}
			for _, id := range a.FieldIDs {
				curFields[id] = true
			}
			for _, id := range a.FieldIDs {
				if !prevFields[id] {
					field, _ := current.Symbols[id].(*DocField)
					label := id
					if field != nil {
						label = field.ShortName + " = " + itoa(field.Number)
					}
					details = append(details, "+ "+label)
				}
			}
			for _, id := range b.FieldIDs {
				if !curFields[id] {
					field, _ := previous.Symbols[id].(*DocField)
					label := id
					if field != nil {
						label = field.ShortName + " = " + itoa(field.Number)
					}
					details = append(details, "- "+label)
				}
			}
		}
	}
	details = append(details, diffOptions(now.Options, then.Options)...)
	return details
}

func diffOptions(current, previous []*DocOption) []string {
	prev := map[string]*DocOption{}
	cur := map[string]*DocOption{}
	for _, option := range previous {
		prev[option.FullName] = option
	}
	for _, option := range current {
		cur[option.FullName] = option
	}
	var details []string
	for name, option := range cur {
		old, ok := prev[name]
		if !ok {
			details = append(details, "Option "+name+" added")
		} else if old.TextProto != option.TextProto {
			details = append(details, "Option "+name+" changed")
		}
	}
	for name := range prev {
		if _, ok := cur[name]; !ok {
			details = append(details, "Option "+name+" removed")
		}
	}
	sort.Strings(details)
	return details
}

func sortChanges(changes []SymbolChange) {
	order := map[string]int{
		"package": 0, "file": 1, "service": 2, "method": 3, "message": 4,
		"field": 5, "oneof": 6, "enum": 7, "enum-value": 8, "extension": 9,
	}
	sort.Slice(changes, func(i, j int) bool {
		if order[changes[i].Kind] != order[changes[j].Kind] {
			return order[changes[i].Kind] < order[changes[j].Kind]
		}
		return changes[i].FullName < changes[j].FullName
	})
}

func itoa(n int32) string {
	return strconvItoa32(n)
}

func strconvItoa32(n int32) string {
	neg := n < 0
	if neg {
		n = -n
	}
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		return "-" + string(digits)
	}
	return string(digits)
}
